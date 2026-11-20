/**
 * A1 over WhatsApp. A shop sends its order as a text message to the
 * platform's WhatsApp number; we find the shop by its phone, keep the message
 * as an OrderDraft, read it (rules, plus AI when the business has it) and
 * reply with what we understood and a link. The shop checks the cart in the
 * app and places it there: a WhatsApp message never places an order by itself.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { asPlatform, withTenantTx, type Tx } from "@/lib/db";
import { emit, kickMessages } from "@/lib/jobs";
import { automationSettings } from "@/lib/automation-settings";
import { tenantUrl } from "@/lib/notify";
import { DRAFT_DAYS, linesSummary, readOrder } from "@/lib/order-intake";
import { MAX_ORDER_TEXT, type ParsedLine } from "@/lib/order-text";

export type InboundText = { from: string; messageId: string; text: string };
export type InboundOther = { from: string; messageId: string; kind: string };
export type IntakeResult =
  | { status: "draft"; tenantId: string; draftId: string; duplicate: boolean }
  | { status: "unknown_number" | "many_businesses" | "off" | "not_text" | "empty" };

/** Meta's X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret). */
export function validSignature(raw: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Last 10 digits of a WhatsApp sender ("919876543210" → "9876543210"). */
export const phone10 = (from: string) => from.replace(/\D/g, "").slice(-10);

/** Shops (active RETAILER logins) with this phone, in live businesses. */
async function shopsWithPhone(phone: string) {
  if (!/^\d{10}$/.test(phone)) return [];
  return asPlatform((tx) =>
    tx.user.findMany({
      where: { phone, role: "RETAILER", active: true, retailerProfile: { isNot: null }, tenant: { status: { in: ["TRIAL", "ACTIVE"] } } },
      select: { id: true, tenantId: true, lang: true, retailerProfile: { select: { id: true } }, tenant: { select: { settings: true } } },
      take: 5,
    })
  );
}

/** Queue a reply to the shop (plain text: we are answering their message). */
async function reply(tx: Tx, tenantId: string, to: { userId: string | null; phone: string; lang: string }, body: string, link: string | null) {
  await tx.messageLog.create({
    data: { tenantId, userId: to.userId, channel: "WHATSAPP", to: to.phone, event: "reply.order", lang: to.lang, body, link },
  });
}

/** A message that isn't for exactly one business: answer from the first match, or not at all. */
async function replyOutside(phone: string, shops: Awaited<ReturnType<typeof shopsWithPhone>>, body: string) {
  const s = shops[0];
  if (!s) return; // a stranger: say nothing
  await withTenantTx(s.tenantId, (tx) => reply(tx, s.tenantId, { userId: s.id, phone, lang: s.lang }, body, null));
  await kickMessages(s.tenantId);
}

const T = {
  many: {
    en: "This number is a shop with more than one distributor here, so we can't tell who this order is for. Please place it in your distributor's app (you can type or speak the order there).",
    hi: "यह नंबर यहाँ एक से ज़्यादा वितरकों के साथ जुड़ा है, इसलिए हम नहीं बता सकते कि ऑर्डर किसके लिए है। कृपया अपने वितरक के ऐप में ऑर्डर करें (वहाँ लिखकर या बोलकर ऑर्डर कर सकते हैं)।",
  },
  notText: {
    en: "We can read orders sent as text. Please type the order here, or open the app and use the mic to speak it.",
    hi: "हम लिखे हुए ऑर्डर पढ़ सकते हैं। कृपया ऑर्डर यहाँ लिखकर भेजें, या ऐप खोलकर माइक से बोलें।",
  },
  off: {
    en: "Orders on WhatsApp aren't turned on for this distributor. Please order in the app.",
    hi: "इस वितरक के लिए WhatsApp पर ऑर्डर चालू नहीं है। कृपया ऐप में ऑर्डर करें।",
  },
};
const say = (k: keyof typeof T, lang: string) => (lang === "hi" ? T[k].hi : T[k].en);

/**
 * A text message from the webhook. Creates the draft (once per WhatsApp
 * message id) and queues the reading; reads it here when the queue is down.
 */
export async function takeWhatsappText(m: InboundText, now = new Date()): Promise<IntakeResult> {
  const phone = phone10(m.from);
  const shops = await shopsWithPhone(phone);
  if (!shops.length) return { status: "unknown_number" };
  if (shops.length > 1) {
    await replyOutside(phone, shops, say("many", shops[0].lang));
    return { status: "many_businesses" };
  }
  const s = shops[0];
  const set = automationSettings(s.tenant.settings).orderText;
  if (!set.on || !set.whatsapp) {
    await replyOutside(phone, shops, say("off", s.lang));
    return { status: "off" };
  }
  const text = m.text.slice(0, MAX_ORDER_TEXT).trim();
  if (!text) return { status: "empty" };

  const { draft, duplicate } = await withTenantTx(s.tenantId, async (tx) => {
    const seen = await tx.orderDraft.findUnique({ where: { tenantId_messageId: { tenantId: s.tenantId, messageId: m.messageId } }, select: { id: true } });
    if (seen) return { draft: seen, duplicate: true };
    const d = await tx.orderDraft.create({
      data: { tenantId: s.tenantId, retailerId: s.retailerProfile!.id, channel: "whatsapp", text, messageId: m.messageId, expiresAt: new Date(now.getTime() + DRAFT_DAYS * 86_400_000) },
      select: { id: true },
    });
    return { draft: d, duplicate: false };
  });
  if (!duplicate) {
    const job = await emit("order.message", { tenantId: s.tenantId, draftId: draft.id });
    if (!job) await readDraft(s.tenantId, draft.id, now);
  }
  return { status: "draft", tenantId: s.tenantId, draftId: draft.id, duplicate };
}

/** Audio, images and the rest: ask for text (only shops we know get an answer). */
export async function takeWhatsappOther(m: InboundOther): Promise<IntakeResult> {
  const phone = phone10(m.from);
  const shops = await shopsWithPhone(phone);
  if (shops.length) await replyOutside(phone, shops, say("notText", shops[0].lang));
  return { status: shops.length ? "not_text" : "unknown_number" };
}

/** Reads a waiting draft and replies with what we understood (the "order.message" job). */
export async function readDraft(tenantId: string, draftId: string, now = new Date()) {
  const d = await withTenantTx(tenantId, (tx) =>
    tx.orderDraft.findUnique({ where: { id: draftId }, include: { retailer: { select: { userId: true, user: { select: { phone: true, lang: true } } } } } })
  );
  if (!d || d.status !== "READING") return null;
  const read = await readOrder({ tenantId, actorId: d.retailer.userId, retailerId: d.retailerId, text: d.text, now });
  const lang = d.retailer.user.lang;
  const found = read.lines.filter((l) => l.productId);
  const byId = new Map(read.products.map((p) => [p.id, p]));
  const link = await withTenantTx(tenantId, (tx) => tenantUrl(tx, tenantId, `/retailer/catalogue?draft=${d.id}`));
  const body = !read.lines.length
    ? lang === "hi"
      ? `हमें इस संदेश में कोई सामान नहीं मिला। ऑर्डर ऐसे लिखें: "5 पेटी नींबू, 2 जीरा"। या ऐप में ऑर्डर करें: ${link}`
      : `We couldn't find any items in that message. Write it like "5 peti nimbu, 2 jeera", or order in the app: ${link}`
    : lang === "hi"
      ? `आपका ऑर्डर हमने ऐसे पढ़ा:\n${linesSummary(read.lines, byId)}\n\nजाँचकर ऑर्डर करें (${DRAFT_DAYS} दिन तक): ${link}\nऑर्डर तभी बनेगा जब आप ऐप में "Place order" दबाएँगे।`
      : `Here's how we read your order:\n${linesSummary(read.lines, byId)}\n\nCheck it and place it (within ${DRAFT_DAYS} days): ${link}\nNothing is ordered until you tap "Place order" in the app.`;
  const updated = await withTenantTx(tenantId, async (tx) => {
    const n = await tx.orderDraft.updateMany({
      where: { id: d.id, status: "READING" },
      data: { status: "OPEN", lines: read.lines as unknown as Prisma.InputJsonValue, source: read.source, reply: body },
    });
    if (n.count && d.retailer.user.phone) await reply(tx, tenantId, { userId: d.retailer.userId, phone: d.retailer.user.phone, lang }, body, link);
    return n.count;
  });
  if (updated) await kickMessages(tenantId);
  return { lines: read.lines, found: found.length, source: read.source };
}

/** An open draft for this shop (for the review sheet), or null. */
export async function openDraft(tx: Tx, retailerId: string, draftId: string, now = new Date()) {
  const d = await tx.orderDraft.findFirst({ where: { id: draftId, retailerId }, select: { id: true, text: true, lines: true, status: true, source: true, expiresAt: true, orderId: true } });
  if (!d) return null;
  const status = d.status === "OPEN" && d.expiresAt <= now ? "EXPIRED" : d.status;
  return { id: d.id, text: d.text, lines: (status === "OPEN" ? d.lines : []) as unknown as ParsedLine[], status, source: d.source, orderId: d.orderId };
}

/** Placing an order from a draft uses it up (only an open draft of the same shop). */
export async function spendDraft(tx: Tx, retailerId: string, draftId: string, orderId: string, now = new Date()) {
  const n = await tx.orderDraft.updateMany({ where: { id: draftId, retailerId, status: "OPEN", expiresAt: { gt: now } }, data: { status: "USED", orderId } });
  return n.count > 0;
}

/** Old drafts nobody used (daily, with the other automations). */
export async function expireDrafts(tx: Tx, now = new Date()) {
  const n = await tx.orderDraft.updateMany({ where: { status: { in: ["OPEN", "READING"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  return n.count;
}
