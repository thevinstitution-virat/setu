/**
 * A13 catalogue assist (roadmap §7): Hindi names and HSN codes for products
 * that lack them. Uses the AI gateway when the business can use AI, else the
 * plain rules (lib/catalogue-rules.ts). Each proposal is a "catalogue"
 * Suggestion (Products → Catalogue assist) that someone with
 * catalogue.manage checks, may edit, and accepts; only then is the product
 * changed. Only product data (name, brand, category, unit) is sent to AI.
 */
import * as z from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { withTenantTx } from "@/lib/db";
import { MoneyError, type Ctx } from "@/lib/ledger";
import { GST_RATES } from "@/lib/catalogue-api";
import { aiJson, aiStatus } from "@/lib/ai";
import { hindiName, hsnByKeyword, hsnFromCategory } from "@/lib/catalogue-rules";
import { suggest } from "@/lib/suggest";

export type CatalogueField = "nameHi" | "hsn";
export const isCatalogueField = (v: unknown): v is CatalogueField => v === "nameHi" || v === "hsn";
export type CatalogueEdit = { nameHi?: string; hsnCode?: string; gstRate?: number };

const DAY_MS = 86_400_000;
const BATCH = 25;
const DEVANAGARI = /[ऀ-ॿ]/;

type Item = { id: string; name: string; brand: string | null; category: string; unit: string; hsnCode: string | null; gstRate: number; categoryId: string };
type Proposal = { productId: string; proposed: CatalogueEdit; source: "ai" | "rules"; confidence: "high" | "medium" | "low"; why: string };

const NAME_SYSTEM = `You write Hindi (Devanagari) product names for an Indian grocery and FMCG distributor's catalogue, read by shopkeepers.
Rules: translate generic words (tea → चाय, salt → नमक, biscuits → बिस्कुट); keep brand names, spelt the way Hindi speakers say them; keep sizes as digits with Hindi units (250 ग्राम, 1 किलो, 500 मिली, 1 लीटर); no English letters; short, as printed on a shop's price list.`;

const HSN_SYSTEM = `You suggest the HSN code and GST rate for products of an Indian grocery and FMCG distributor (GST rates in force from 22 September 2025).
Give the most specific HSN code you are sure of (4 digits, or 6–8 if certain), the GST rate in % (one of 0, 0.25, 3, 5, 18, 40), your confidence, and a reason of a few words. Use "low" confidence when the product name is ambiguous.`;

const nameSchema = z.object({ items: z.array(z.object({ i: z.number().int(), nameHi: z.string() })) });
const hsnSchema = z.object({ items: z.array(z.object({ i: z.number().int(), hsn: z.string(), gstRate: z.number(), confidence: z.enum(["high", "medium", "low"]), why: z.string() })) });

const describe = (it: Item, i: number) => `${i}. ${it.name}${it.brand ? ` | brand: ${it.brand}` : ""} | category: ${it.category} | sold per: ${it.unit}`;

/** Products missing the field, without an open suggestion for it. */
async function missing(tenantId: string, field: CatalogueField, limit: number) {
  return withTenantTx(tenantId, async (tx) => {
    const open = new Set(
      (await tx.suggestion.findMany({ where: { kind: "catalogue", status: "OPEN", dedupeKey: { startsWith: `catalogue:${field}:` } }, select: { subjectId: true } })).map((s) => s.subjectId)
    );
    const rows = await tx.product.findMany({
      where: { active: true, ...(field === "nameHi" ? { OR: [{ nameHi: null }, { nameHi: "" }] } : { OR: [{ hsnCode: null }, { hsnCode: "" }] }) },
      select: { id: true, name: true, unit: true, hsnCode: true, gstRate: true, categoryId: true, brand: { select: { name: true } }, category: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    return rows
      .filter((r) => !open.has(r.id))
      .slice(0, limit)
      .map((r) => ({ id: r.id, name: r.name, unit: r.unit, hsnCode: r.hsnCode, gstRate: r.gstRate, categoryId: r.categoryId, brand: r.brand?.name ?? null, category: r.category.name }));
  });
}

/** How many active products lack each field. */
export async function missingCounts(tenantId: string) {
  return withTenantTx(tenantId, async (tx) => ({
    nameHi: await tx.product.count({ where: { active: true, OR: [{ nameHi: null }, { nameHi: "" }] } }),
    hsn: await tx.product.count({ where: { active: true, OR: [{ hsnCode: null }, { hsnCode: "" }] } }),
  }));
}

function rulesNames(items: Item[]): Proposal[] {
  return items.map((it) => ({ productId: it.id, proposed: { nameHi: hindiName(it.name) }, source: "rules", confidence: "low", why: "Known words translated, the rest spelt by sound: check the spelling" }));
}

async function rulesHsn(tenantId: string, items: Item[]): Promise<Proposal[]> {
  const siblings = await withTenantTx(tenantId, (tx) =>
    tx.product.findMany({ where: { categoryId: { in: [...new Set(items.map((i) => i.categoryId))] }, hsnCode: { not: null } }, select: { categoryId: true, hsnCode: true, gstRate: true } })
  );
  const out: Proposal[] = [];
  for (const it of items) {
    const cat = hsnFromCategory(siblings.filter((s) => s.categoryId === it.categoryId));
    const kw = hsnByKeyword(it.name, it.category);
    if (kw) out.push({ productId: it.id, proposed: { hsnCode: kw.hsn, gstRate: kw.gstRate }, source: "rules", confidence: cat?.hsn === kw.hsn ? "medium" : "low", why: `Looks like ${kw.label.toLowerCase()} (built-in list)` });
    else if (cat) out.push({ productId: it.id, proposed: { hsnCode: cat.hsn, gstRate: cat.gstRate }, source: "rules", confidence: "low", why: `Used by ${cat.count} other product${cat.count === 1 ? "" : "s"} in ${it.category}` });
  }
  return out;
}

async function aiNames(tenantId: string, actorId: string | null, items: Item[]) {
  const r = await aiJson({ tenantId, actorId, feature: "catalogue.name_hi", system: NAME_SYSTEM, prompt: `Products:\n${items.map(describe).join("\n")}\n\nGive nameHi for each, by its number i.`, schema: nameSchema, maxTokens: 4000 });
  if (!r.ok) return r;
  const out: Proposal[] = [];
  for (const x of r.data.items) {
    const it = items[x.i];
    const name = x.nameHi.trim().slice(0, 120);
    if (!it || !DEVANAGARI.test(name) || /[A-Za-z]/.test(name)) continue;
    out.push({ productId: it.id, proposed: { nameHi: name }, source: "ai", confidence: "medium", why: "Written by AI: check brand spellings" });
  }
  return { ok: true as const, proposals: out, credits: r.credits };
}

async function aiHsn(tenantId: string, actorId: string | null, items: Item[]) {
  const r = await aiJson({ tenantId, actorId, feature: "catalogue.hsn", system: HSN_SYSTEM, prompt: `Products:\n${items.map(describe).join("\n")}\n\nGive hsn, gstRate, confidence and why for each, by its number i.`, schema: hsnSchema, maxTokens: 6000 });
  if (!r.ok) return r;
  const out: Proposal[] = [];
  for (const x of r.data.items) {
    const it = items[x.i];
    const hsn = x.hsn.replace(/\D/g, "");
    if (!it || !/^\d{4,8}$/.test(hsn) || !GST_RATES.includes(x.gstRate)) continue;
    out.push({ productId: it.id, proposed: { hsnCode: hsn, gstRate: x.gstRate }, source: "ai", confidence: x.confidence, why: x.why.slice(0, 160) });
  }
  return { ok: true as const, proposals: out, credits: r.credits };
}

/**
 * Proposes `field` for up to `limit` products that lack it. AI in batches
 * of 25 when available (a failed batch falls back to the rules), else rules.
 * The business's own HSN table always decides the GST rate.
 */
export async function runCatalogueAssist(tenantId: string, actorId: string | null, field: CatalogueField, opts: { limit?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const items = await missing(tenantId, field, Math.min(opts.limit ?? 100, 200));
  const status = await aiStatus(tenantId, now);
  const proposals: Proposal[] = [];
  let credits = 0;
  let aiNote: string | null = status.available ? null : status.message;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    if (status.available) {
      const r = field === "nameHi" ? await aiNames(tenantId, actorId, batch) : await aiHsn(tenantId, actorId, batch);
      if (r.ok) {
        credits += r.credits;
        proposals.push(...r.proposals);
        const done = new Set(r.proposals.map((p) => p.productId));
        const left = batch.filter((b) => !done.has(b.id));
        if (left.length) proposals.push(...(field === "nameHi" ? rulesNames(left) : await rulesHsn(tenantId, left)));
        continue;
      }
      aiNote = `${r.message}; the built-in rules were used instead.`;
    }
    proposals.push(...(field === "nameHi" ? rulesNames(batch) : await rulesHsn(tenantId, batch)));
  }

  const made = await withTenantTx(
    tenantId,
    async (tx) => {
      const table = new Map((await tx.hsnCode.findMany({ select: { code: true, gstRate: true } })).map((h) => [h.code, h.gstRate]));
      const byId = new Map(items.map((it) => [it.id, it]));
      let n = 0;
      for (const p of proposals) {
        const it = byId.get(p.productId)!;
        const proposed = { ...p.proposed };
        let why = p.why;
        if (proposed.hsnCode && table.has(proposed.hsnCode)) {
          proposed.gstRate = table.get(proposed.hsnCode)!;
          why += "; GST rate from your HSN table";
        }
        const ok = await suggest(tx, {
          kind: "catalogue",
          subjectType: "product",
          subjectId: it.id,
          title: it.name,
          detail: why,
          reasons: [p.source === "ai" ? "AI" : "Rules", `${p.confidence} confidence`],
          payload: { field, productId: it.id, productName: it.name, category: it.category, current: field === "hsn" ? { hsnCode: it.hsnCode, gstRate: it.gstRate } : { nameHi: null }, proposed, source: p.source, confidence: p.confidence } as unknown as Prisma.InputJsonValue,
          score: p.confidence === "high" ? 70 : p.confidence === "medium" ? 50 : 30,
          dedupeKey: `catalogue:${field}:${it.id}:${now.getTime()}`,
          expiresAt: new Date(now.getTime() + 30 * DAY_MS),
        });
        if (ok) n++;
      }
      return n;
    },
    { timeout: 60_000 }
  );
  return { looked: items.length, made, credits, source: status.available && !aiNote ? "ai" : status.available ? "mixed" : "rules", note: aiNote };
}

/** Accepting a catalogue suggestion: the (possibly edited) value is written to the product. */
export async function applyCatalogue(ctx: Ctx, p: Record<string, unknown>, edit?: CatalogueEdit) {
  const field = p.field as CatalogueField;
  const product = await ctx.tx.product.findUnique({ where: { id: p.productId as string }, select: { id: true, name: true, nameHi: true, hsnCode: true, gstRate: true } });
  if (!product) throw new MoneyError("Product not found", 404);
  const proposed = { ...(p.proposed as CatalogueEdit), ...(edit ?? {}) };
  if (field === "nameHi") {
    const nameHi = (proposed.nameHi ?? "").trim().slice(0, 120);
    if (!nameHi) throw new MoneyError("Write the Hindi name, or reject the suggestion");
    await ctx.tx.product.update({ where: { id: product.id }, data: { nameHi } });
    return { productId: product.id, before: { nameHi: product.nameHi }, after: { nameHi } };
  }
  const hsnCode = (proposed.hsnCode ?? "").replace(/\D/g, "");
  if (!/^\d{4,8}$/.test(hsnCode)) throw new MoneyError("HSN code must be 4 to 8 digits");
  const fromTable = await ctx.tx.hsnCode.findFirst({ where: { code: hsnCode }, select: { gstRate: true } });
  const gstRate = fromTable ? fromTable.gstRate : Number(proposed.gstRate);
  if (!GST_RATES.includes(gstRate)) throw new MoneyError(`GST must be one of ${GST_RATES.join(", ")}%`);
  await ctx.tx.product.update({ where: { id: product.id }, data: { hsnCode, gstRate } });
  return { productId: product.id, before: { hsnCode: product.hsnCode, gstRate: product.gstRate }, after: { hsnCode, gstRate } };
}
