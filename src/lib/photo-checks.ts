/**
 * Photo checks (roadmap §7 A3, A8, A10), server side.
 *
 * - A3: UPI screenshots, bank confirmations and cheque photos waiting in the
 *   "To verify" queue are read and compared with what was entered. The office
 *   still verifies or rejects the payment; the result is only a note.
 * - A8: delivery photos that are reused, blank or show no shop or goods, and
 *   crate pickups whose photo shows a different count, become "check"
 *   Suggestions.
 * - A10: shelf photos are read for facings when they are taken (readShelf);
 *   saved audits are only checked for reuse here.
 *
 * Without AI (no key, plan without `ai`, AI off, cap used up) the same photo
 * used twice (SHA-256) and the same UTR on two payments are still caught.
 * Photos go to the AI provider only for businesses that turned the reading
 * on in Settings → Automation; names and phone numbers are never asked for.
 */
import { createHash } from "node:crypto";
import * as z from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { asPlatform, withTenantTx, type Tx } from "@/lib/db";
import { aiJson, type AiImage } from "@/lib/ai";
import { getFile, keyBelongsTo } from "@/lib/storage";
import { istDay } from "@/lib/field-math";
import { formatINR } from "@/lib/money";
import { automationSettings, type AutomationSettings } from "@/lib/automation-settings";
import { suggest } from "@/lib/suggest";
import { ANOMALY_LABEL, type AnomalyKind } from "@/lib/automation-math";
import {
  FLAG_LABEL,
  MAX_FACINGS,
  comparePayment,
  deliveryVerdict,
  pickupVerdict,
  type DeliveryRead,
  type PaymentRead,
  type PhotoFlag,
  type PhotoResult,
  type PickupRead,
} from "@/lib/photo-rules";
import { HOUR, limited } from "@/lib/rate-limit";

export type PhotoSubject = "payment" | "delivery" | "pickup" | "shelf";
export const PHOTO_SUBJECTS: PhotoSubject[] = ["payment", "delivery", "pickup", "shelf"];

const DAY_MS = 86_400_000;
const rs = (p: number) => formatINR(p, { whole: true });
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const READABLE = ["image/jpeg", "image/png", "image/webp"];

// ---------- what the AI is asked ----------

const paymentSchema = z.object({
  readable: z.boolean(),
  kind: z.enum(["upi", "bank", "cheque", "other"]),
  amount: z.number().nullable(),
  reference: z.string().max(60).nullable(),
  date: z.string().max(20).nullable(),
  status: z.enum(["success", "pending", "failed", "unknown"]),
  chequeNumber: z.string().max(20).nullable(),
  signed: z.boolean().nullable(),
});
const PAYMENT_SYSTEM = [
  "You read photos of payment proofs for the office of an Indian wholesale distributor: UPI app screenshots, bank transfer confirmations and cheques.",
  "Report only what you can see. When a value isn't visible or you can't read it for sure, answer null. Never guess digits.",
  "Never report names, phone numbers, UPI ids or account numbers.",
].join(" ");
const PAYMENT_PROMPT = [
  "What does this photo show?",
  "- readable: false if the photo is blank, dark, cut off or too blurred to read.",
  '- kind: "upi" for a UPI app screen (any app), "bank" for a bank transfer (NEFT/IMPS/RTGS) confirmation, "cheque" for a cheque, "other" for anything else.',
  "- amount: the amount paid in rupees as a number (5000 or 5000.5), without commas or the ₹ sign.",
  "- reference: the UPI reference / UTR / transaction id (digits and letters only), not an order id.",
  "- date: the payment date (or the date written on a cheque) as YYYY-MM-DD.",
  "- status: success, pending or failed as the screen says; unknown if it doesn't say (and for cheques).",
  "- chequeNumber: for a cheque, the 6-digit cheque number at the start of the code line at the bottom; otherwise null.",
  "- signed: for a cheque, whether there is a signature; otherwise null.",
].join("\n");

const deliverySchema = z.object({ readable: z.boolean(), blank: z.boolean(), showsShop: z.boolean(), showsGoods: z.boolean(), note: z.string().max(160) });
const DELIVERY_SYSTEM = "You look at proof-of-delivery photos that delivery drivers of an Indian wholesale distributor take when they hand goods to a shop. Report only what you can see. Don't describe people.";
const DELIVERY_PROMPT = [
  "Look at this delivery photo.",
  "- readable: false if it is too blurred, dark or cut off to tell what it shows.",
  "- blank: true if it is black, white, the inside of a pocket, a floor or ceiling only, or a screenshot of something else.",
  "- showsShop: a shop front, counter, shelves or store room is visible.",
  "- showsGoods: cartons, crates, bags, cases or packs of goods are visible.",
  "- note: one short sentence on what the photo shows (no names), or an empty string.",
].join("\n");

const pickupSchema = z.object({ readable: z.boolean(), crates: z.number().int().min(0).max(MAX_FACINGS).nullable() });
const PICKUP_SYSTEM = "You count returnable crates, cases or empties in photos taken by delivery drivers of an Indian wholesale distributor when they collect empties from a shop. Count each one once; count stacked ones by their visible edges. Answer null if you can't count them.";

const shelfSchema = z.object({
  readable: z.boolean(),
  ours: z.number().int().min(0).max(MAX_FACINGS),
  others: z.number().int().min(0).max(MAX_FACINGS),
  empty: z.number().int().min(0).max(MAX_FACINGS),
  seen: z.array(z.number().int().min(1).max(200)).max(60),
  note: z.string().max(160),
});
const SHELF_SYSTEM =
  "You audit shelf photos taken by sales agents of an Indian wholesale distributor in the shops they supply. A facing is one pack front facing out on the shelf. Count carefully and report only what you can see. Don't describe people.";

// ---------- one check ----------

type Loaded = {
  fileKey: string;
  label: string;
  /** For the rule comparison. */
  compare: (read: unknown, ctx: { reused: boolean; referenceUsedBy: string | null }) => PhotoResult;
  ai: { feature: string; system: string; prompt: string; schema: z.ZodType<unknown> } | null;
  reference?: string | null;
  method?: string;
  actorId: string | null;
};

const settingsOf = async (tx: Tx, tenantId: string) => automationSettings((await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings);

/** Whether photos of this kind may be sent to the AI. */
export function readsWithAi(s: AutomationSettings, type: PhotoSubject) {
  if (type === "shelf") return false; // read when taken (readShelf); the saved counts are a person's
  if (!s.photos.on) return false;
  return type === "payment" ? s.photos.payments : s.photos.delivery;
}

async function load(tx: Tx, type: PhotoSubject, id: string, s: AutomationSettings): Promise<Loaded | null> {
  const ai = readsWithAi(s, type);
  if (type === "payment") {
    const p = await tx.payment.findUnique({
      where: { id },
      select: { number: true, method: true, amount: true, reference: true, proofKey: true, collectedAt: true, collectedById: true, retailer: { select: { outletName: true } }, cheque: { select: { number: true, chequeDate: true } } },
    });
    if (!p?.proofKey) return null;
    const entered = {
      method: p.method,
      amount: p.amount,
      reference: p.reference,
      chequeNumber: p.cheque?.number ?? null,
      collectedDay: istDay(p.collectedAt),
      chequeDate: p.cheque ? istDay(p.cheque.chequeDate) : null,
    };
    return {
      fileKey: p.proofKey,
      label: `${p.number} from ${p.retailer.outletName} (${rs(p.amount)})`,
      compare: (read, ctx) => comparePayment(read as PaymentRead | null, entered, ctx),
      ai: ai ? { feature: "photo.payment", system: PAYMENT_SYSTEM, prompt: PAYMENT_PROMPT, schema: paymentSchema } : null,
      reference: p.method === "UPI" || p.method === "BANK" ? p.reference : null,
      method: p.method,
      actorId: p.collectedById,
    };
  }
  if (type === "delivery") {
    const d = await tx.delivery.findUnique({ where: { id }, select: { podPhotoUrl: true, order: { select: { orderNumber: true, retailer: { select: { outletName: true } } } }, deliveryAgent: { select: { userId: true, user: { select: { name: true } } } } } });
    if (!d?.podPhotoUrl) return null;
    return {
      fileKey: d.podPhotoUrl,
      label: `${d.order.orderNumber} to ${d.order.retailer.outletName} (${d.deliveryAgent.user.name})`,
      compare: (read, ctx) => deliveryVerdict(read as DeliveryRead | null, ctx),
      ai: ai ? { feature: "photo.delivery", system: DELIVERY_SYSTEM, prompt: DELIVERY_PROMPT, schema: deliverySchema } : null,
      actorId: d.deliveryAgent.userId,
    };
  }
  if (type === "pickup") {
    const m = await tx.returnableMove.findUnique({ where: { id }, select: { kind: true, photoKey: true, taken: true, actorId: true, returnable: { select: { name: true } }, retailer: { select: { outletName: true } } } });
    if (!m?.photoKey || m.kind !== "PICKUP") return null;
    return {
      fileKey: m.photoKey,
      label: `${m.taken} × ${m.returnable.name} from ${m.retailer.outletName}`,
      compare: (read, ctx) => pickupVerdict(read as PickupRead | null, m.taken, ctx),
      ai: ai
        ? {
            feature: "photo.pickup",
            system: PICKUP_SYSTEM,
            prompt: `How many "${m.returnable.name.replace(/"/g, "'")}" are in this photo? readable: false if you can't tell. crates: the count, or null.`,
            schema: pickupSchema,
          }
        : null,
      actorId: m.actorId,
    };
  }
  const a = await tx.shelfAudit.findUnique({ where: { id }, select: { photoKey: true, byId: true, retailer: { select: { outletName: true } }, by: { select: { name: true } } } });
  if (!a) return null;
  return {
    fileKey: a.photoKey,
    label: `${a.retailer.outletName} (${a.by.name})`,
    compare: (_read, ctx) => {
      const flags: PhotoFlag[] = ctx.reused ? ["reused"] : [];
      return { verdict: ctx.reused ? "bad" : "ok", flags, notes: ctx.reused ? ["This shelf photo was already used for another entry."] : [], summary: ctx.reused ? FLAG_LABEL.reused : "Checked for reuse only" };
    },
    ai: null,
    actorId: a.byId,
  };
}

export type PhotoCheckView = { verdict: "ok" | "warn" | "bad"; flags: PhotoFlag[]; source: "rules" | "ai"; summary: string; notes: string[]; checkedAt: string };

/** The check as the screens show it. */
export function viewOf(c: { verdict: string; flags: string[]; source: string; result: Prisma.JsonValue; checkedAt: Date }): PhotoCheckView {
  const r = (c.result ?? {}) as { summary?: string; notes?: string[] };
  return { verdict: c.verdict as PhotoCheckView["verdict"], flags: c.flags as PhotoFlag[], source: c.source as "rules" | "ai", summary: r.summary ?? "", notes: r.notes ?? [], checkedAt: c.checkedAt.toISOString() };
}

/**
 * Checks the photo on one payment, delivery, pickup or shelf audit and saves
 * the result (once per photo; `force` checks again). Never throws for a
 * missing photo or AI trouble: returns null when there is nothing to check.
 */
export async function checkSubject(tenantId: string, type: PhotoSubject, id: string, o: { now?: Date; force?: boolean } = {}) {
  const now = o.now ?? new Date();
  const first = await withTenantTx(tenantId, async (tx) => {
    const s = await settingsOf(tx, tenantId);
    const l = await load(tx, type, id, s);
    if (!l || !keyBelongsTo(l.fileKey, tenantId)) return null;
    const existing = await tx.photoCheck.findUnique({ where: { tenantId_subjectType_subjectId_fileKey: { tenantId, subjectType: type, subjectId: id, fileKey: l.fileKey } } });
    return { l, existing };
  });
  if (!first) return null;
  if (first.existing && !o.force) return first.existing;
  const { l } = first;
  const file = await getFile(l.fileKey);
  if (!file) return null;
  const hash = sha256(file.bytes);

  const { reusedBy, referenceUsedBy } = await withTenantTx(tenantId, async (tx) => {
    // A pickup of several crate types saves one row per type with the same upload: not a reuse.
    const sameUpload = type === "pickup" ? [{ subjectType: "pickup", fileKey: l.fileKey }] : [];
    const other = await tx.photoCheck.findFirst({
      where: { hash, NOT: [{ subjectType: type, subjectId: id }, ...sameUpload] },
      orderBy: { checkedAt: "asc" },
      select: { subjectType: true, subjectId: true },
    });
    const ref = l.reference?.trim();
    const dup =
      ref && ref.length >= 6
        ? await tx.payment.findFirst({ where: { id: { not: id }, method: { in: ["UPI", "BANK"] }, state: { not: "REJECTED" }, reference: { equals: ref, mode: "insensitive" } }, orderBy: { collectedAt: "asc" }, select: { number: true } })
        : null;
    return { reusedBy: other, referenceUsedBy: dup?.number ?? null };
  });

  let read: unknown = null;
  let credits = 0;
  if (l.ai && READABLE.includes(file.contentType)) {
    const images: AiImage[] = [{ bytes: file.bytes, contentType: file.contentType }];
    const r = await aiJson({ tenantId, actorId: null, feature: l.ai.feature, system: l.ai.system, prompt: l.ai.prompt, schema: l.ai.schema, maxTokens: 1500, now, images });
    if (r.ok) {
      read = r.data;
      credits = r.credits;
    }
  }
  const res = l.compare(read, { reused: !!reusedBy, referenceUsedBy });
  const result = { ...res, read: read ?? null, reusedBy: reusedBy ?? null, referenceUsedBy } as unknown as Prisma.InputJsonValue;

  return withTenantTx(tenantId, async (tx) => {
    const data = { hash, source: read ? "ai" : "rules", verdict: res.verdict, flags: res.flags, result, credits, checkedAt: now };
    const row = await tx.photoCheck.upsert({
      where: { tenantId_subjectType_subjectId_fileKey: { tenantId, subjectType: type, subjectId: id, fileKey: l.fileKey } },
      create: { subjectType: type, subjectId: id, fileKey: l.fileKey, ...data },
      update: data,
    });
    await flagIt(tx, type, id, l, res, now);
    return row;
  });
}

/** Turns the worst results into "check" Suggestions (payments: only reuse; the queue shows the rest). */
async function flagIt(tx: Tx, type: PhotoSubject, id: string, l: Loaded, res: PhotoResult, now: Date) {
  const expiresAt = new Date(now.getTime() + 14 * DAY_MS);
  const kinds: AnomalyKind[] = [];
  if (res.flags.includes("reused")) kinds.push("photo_reused");
  if (res.flags.includes("reference_reused")) kinds.push("reference_reused");
  if (type === "delivery" && res.flags.some((f) => f === "blank" || f === "unclear" || f === "no_shop_or_goods")) kinds.push("photo_unclear");
  if (type === "pickup" && res.flags.includes("crates_differ")) kinds.push("crates_mismatch");
  const what = { payment: "Payment", delivery: "Delivery", pickup: "Crate pickup", shelf: "Shelf audit" }[type];
  for (const kind of kinds) {
    await suggest(tx, {
      kind: "check",
      subjectType: type,
      subjectId: id,
      title: `${ANOMALY_LABEL[kind]}: ${l.label}`,
      detail: [`${what}.`, ...res.notes].join(" "),
      reasons: res.flags.map((f) => FLAG_LABEL[f]),
      payload: { check: kind, photoKey: l.fileKey, flags: res.flags },
      score: kind === "photo_reused" || kind === "reference_reused" ? 70 : kind === "crates_mismatch" ? 50 : 35,
      dedupeKey: `check:photo:${type}:${id}:${kind}`,
      expiresAt,
    });
  }
}

// ---------- sweeps ----------

/** Photos not checked yet: payments to verify, deliveries and pickups from the last 3 days, shelf audits. */
export async function sweepPhotos(tenantId: string, o: { now?: Date; limit?: number } = {}) {
  const now = o.now ?? new Date();
  const limit = o.limit ?? 40;
  const since = new Date(now.getTime() - 3 * DAY_MS);
  const todo = await withTenantTx(tenantId, async (tx) => {
    const [pay, del, pick, shelf] = await Promise.all([
      tx.payment.findMany({ where: { state: "PENDING_VERIFICATION", proofKey: { not: null }, collectedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } }, select: { id: true, proofKey: true }, orderBy: { collectedAt: "asc" }, take: 200 }),
      tx.delivery.findMany({ where: { state: "DELIVERED", deliveredAt: { gte: since }, podPhotoUrl: { not: null } }, select: { id: true, podPhotoUrl: true }, orderBy: { deliveredAt: "asc" }, take: 200 }),
      tx.returnableMove.findMany({ where: { kind: "PICKUP", photoKey: { not: null }, createdAt: { gte: since } }, select: { id: true, photoKey: true }, orderBy: { createdAt: "asc" }, take: 200 }),
      tx.shelfAudit.findMany({ where: { createdAt: { gte: since } }, select: { id: true, photoKey: true }, orderBy: { createdAt: "asc" }, take: 200 }),
    ]);
    const all: { type: PhotoSubject; id: string; key: string }[] = [
      ...pay.map((x) => ({ type: "payment" as const, id: x.id, key: x.proofKey! })),
      ...del.map((x) => ({ type: "delivery" as const, id: x.id, key: x.podPhotoUrl! })),
      ...pick.map((x) => ({ type: "pickup" as const, id: x.id, key: x.photoKey! })),
      ...shelf.map((x) => ({ type: "shelf" as const, id: x.id, key: x.photoKey })),
    ];
    if (!all.length) return [];
    const done = await tx.photoCheck.findMany({ where: { subjectId: { in: all.map((x) => x.id) } }, select: { subjectType: true, subjectId: true, fileKey: true } });
    const seen = new Set(done.map((d) => `${d.subjectType}:${d.subjectId}:${d.fileKey}`));
    return all.filter((x) => !seen.has(`${x.type}:${x.id}:${x.key}`));
  });
  let checked = 0;
  for (const x of todo.slice(0, limit)) {
    try {
      if (await checkSubject(tenantId, x.type, x.id, { now })) checked++;
    } catch (e) {
      console.error("[photos]", tenantId, x.type, x.id, e);
    }
  }
  return { checked, waiting: Math.max(0, todo.length - limit) };
}

/** Every business (the 5-minute sweep). */
export async function sweepAllPhotos(now = new Date()) {
  const ids = (await asPlatform((tx) => tx.tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true } }))).map((t) => t.id);
  let checked = 0;
  for (const id of ids) checked += (await sweepPhotos(id, { now })).checked;
  return { tenants: ids.length, checked };
}

/** The saved checks for some subjects, by subject id (latest photo only). */
export async function checksFor(tenantId: string, type: PhotoSubject, items: { id: string; key: string | null }[]) {
  const withKey = items.filter((i) => i.key);
  if (!withKey.length) return new Map<string, PhotoCheckView>();
  const rows = await withTenantTx(tenantId, (tx) => tx.photoCheck.findMany({ where: { subjectType: type, subjectId: { in: withKey.map((i) => i.id) } } }));
  const keyOf = new Map(withKey.map((i) => [i.id, i.key]));
  return new Map(rows.filter((r) => keyOf.get(r.subjectId) === r.fileKey).map((r) => [r.subjectId, viewOf(r)]));
}

// ---------- A10: reading a shelf photo ----------

export type ShelfRead = { ours: number; others: number; empty: number; seen: { id: string; name: string }[]; note: string };

/**
 * Reads a shelf photo just taken at a shop: our facings, other brands', empty
 * slots and which of our products are on it. The agent checks and edits the
 * counts before saving; ok: false means "type them in".
 */
export async function readShelf(tenantId: string, o: { actorId: string; retailerId: string; photoKey: string; now?: Date }): Promise<{ ok: true; read: ShelfRead; credits: number } | { ok: false; message: string }> {
  const now = o.now ?? new Date();
  if (!keyBelongsTo(o.photoKey, tenantId)) return { ok: false, message: "That photo isn't from this business" };
  if (await limited(`ai-shelf:${tenantId}`, o.actorId, 30, HOUR, now)) return { ok: false, message: "Many shelf photos were read this hour. Count and type them in." };
  const ctx = await withTenantTx(tenantId, async (tx) => {
    const s = await settingsOf(tx, tenantId);
    if (!s.shelf.on) return null;
    const since = new Date(now.getTime() - 90 * DAY_MS);
    const bought = await tx.orderItem.groupBy({ by: ["productId"], where: { order: { retailerId: o.retailerId, createdAt: { gte: since } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 40 });
    const ids = bought.map((b) => b.productId);
    const products = ids.length
      ? await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : await tx.product.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 40 });
    const order = new Map(ids.map((id, i) => [id, i]));
    products.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const brands = await tx.brand.findMany({ where: { active: true }, select: { name: true }, orderBy: { sort: "asc" }, take: 20 });
    return { products, brands: brands.map((b) => b.name) };
  });
  if (!ctx) return { ok: false, message: "Shelf audits are turned off in Settings → Automation" };
  const file = await getFile(o.photoKey);
  if (!file) return { ok: false, message: "Couldn't find that photo; take it again" };
  if (!READABLE.includes(file.contentType)) return { ok: false, message: "Only photos can be read; type the counts in" };
  const prompt = [
    "Audit this shop shelf photo.",
    ctx.brands.length ? `Our brands: ${ctx.brands.join(", ")}.` : "",
    "Our products (numbered):",
    ...ctx.products.map((p, i) => `${i + 1}. ${p.name}`),
    "",
    "- readable: false if the photo is too blurred or dark, or isn't a shelf.",
    "- ours: facings of our brands or products. others: facings of any other brand. empty: empty slots where a pack would fit.",
    "- seen: the numbers of our products you can see (only from the list).",
    "- note: one short sentence (for example where our products sit), or an empty string.",
  ]
    .filter(Boolean)
    .join("\n");
  const r = await aiJson({ tenantId, actorId: o.actorId, feature: "photo.shelf", system: SHELF_SYSTEM, prompt, schema: shelfSchema, maxTokens: 2000, now, images: [{ bytes: file.bytes, contentType: file.contentType }] });
  if (!r.ok) {
    const why: Record<string, string> = {
      no_provider: "Photo reading isn't set up yet",
      plan: "Photo reading isn't in your plan",
      off: "AI is turned off",
      cap: "This month's AI credits are used up",
    };
    return { ok: false, message: `${why[r.reason] ?? "Couldn't read the photo"}. Count and type them in.` };
  }
  if (!r.data.readable) return { ok: false, message: "The photo isn't clear enough; take it again or type the counts in" };
  const seen = [...new Set(r.data.seen)].map((n) => ctx.products[n - 1]).filter(Boolean);
  return { ok: true, read: { ours: r.data.ours, others: r.data.others, empty: r.data.empty, seen, note: r.data.note }, credits: r.credits };
}
