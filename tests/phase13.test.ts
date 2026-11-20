/**
 * Phase 13 on a scratch business: A1 order intake (typed / AI / WhatsApp
 * drafts) and A11 "Ask your business". "Now" is Thursday 19 Nov 2026, 09:30 IST.
 *
 *   Shop A owes ₹30,000 on a bill 40 days old (overdue); Shop B owes ₹5,000 on a bill 10 days old.
 *   One order is placed and not delivered yet.
 *
 * Both scratch businesses are purged at the end.
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { createTenantRecord } from "@/lib/signup";
import { purgeTenant } from "@/lib/tenant-data";
import { nextOrderNumber } from "@/lib/orders";
import { addDay, istDay } from "@/lib/field-math";
import { invalidateEntitlements } from "@/lib/plans";
import { setFakeAi } from "@/lib/ai";
import { readOrder } from "@/lib/order-intake";
import { expireDrafts, openDraft, phone10, spendDraft, takeWhatsappOther, takeWhatsappText, validSignature } from "@/lib/order-drafts";
import { whatsappTextBody } from "@/lib/outbox";
import { ask } from "@/lib/ask";
import { createHmac } from "node:crypto";

const rand = () => Math.random().toString(36).slice(2, 8);
const NOW = new Date("2026-11-19T04:00:00Z");
const TODAY = istDay(NOW);
const ago = (days: number) => new Date(`${addDay(TODAY, -days)}T10:00:00+05:30`);
const phone = () => `7${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;

let T = "";
let T2 = "";
let adminId = "";
let shopA = "";
let shopB = "";
let phoneA = "";
let phoneB = "";
const P = { lemon: "", jeera: "", chai250: "", chai1k: "", salt: "" };
const savedProvider = process.env.AI_PROVIDER;

const tx = <R>(fn: (t: Parameters<Parameters<typeof withTenantTx>[1]>[0]) => Promise<R>) => withTenantTx(T, fn, { timeout: 60_000 });
const setSettings = (id: string, settings: object) => asPlatform((t) => t.tenant.update({ where: { id }, data: { settings } }));
const setAiPlan = async (on: boolean) => {
  await asPlatform((t) => t.tenant.update({ where: { id: T }, data: { overrides: on ? { features: { ai: true } } : {} } }));
  invalidateEntitlements(T);
};
const useFakeAi = async () => {
  process.env.AI_PROVIDER = "fake";
  await setAiPlan(true);
};

async function shop(tenantId: string, areaId: string, name: string, ph: string) {
  const u = await tenantDb(tenantId).user.create({
    data: { name, phone: ph, role: "RETAILER", retailerProfile: { create: { outletName: name, shopNumber: "1", complexName: "M", pinCode: "226001", areaId } } },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

beforeAll(async () => {
  const made = await asPlatform((t) =>
    createTenantRecord(t, { slug: `p13${rand()}`, name: `Phase 13 test ${rand()}`, stateCode: "09" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: phone() })
  );
  T = made.tenant.id;
  adminId = made.user.id;
  const db = tenantDb(T);
  const region = await db.region.create({ data: { name: "Lucknow", areas: { create: [{ name: "North" }] } }, include: { areas: true } });
  const cat = await db.category.create({ data: { name: "Grocery" } });
  const product = (name: string, sku: string, o: { nameHi?: string; unit?: string; caseUnit?: string; caseSize?: number } = {}) =>
    db.product.create({ data: { name, sku, categoryId: cat.id, unit: o.unit ?? "pack", price: 5000, mrp: 6000, gstRate: 5, nameHi: o.nameHi, caseUnit: o.caseUnit, caseSize: o.caseSize } }).then((p) => p.id);
  P.lemon = await product("Lemon (nimbu) 1kg", "LEM1", { unit: "bag", caseUnit: "peti", caseSize: 10 });
  P.jeera = await product("Cumin Seeds 100g", "JER1", { nameHi: "जीरा 100 ग्राम" });
  P.chai250 = await product("Masala Chai 250g", "CH250", { nameHi: "मसाला चाय 250 ग्राम", caseUnit: "box", caseSize: 12 });
  P.chai1k = await product("Masala Chai 1kg", "CH1K", { nameHi: "मसाला चाय 1 किलो" });
  P.salt = await product("Salt 1kg", "SLT1", { nameHi: "नमक 1 किलो", caseUnit: "bag", caseSize: 25 });
  phoneA = phone();
  phoneB = phone();
  shopA = await shop(T, region.areas[0].id, "Shop A", phoneA);
  shopB = await shop(T, region.areas[0].id, "Shop B", phoneB);

  await db.bill.create({ data: { retailerId: shopA, kind: "OPENING", number: "OB-1", date: ago(40), dueDate: ago(25), amount: 3_000_000 } });
  await db.bill.create({ data: { retailerId: shopB, kind: "OPENING", number: "OB-2", date: ago(10), dueDate: addDayDate(5), amount: 500_000 } });
  await db.order.create({
    data: { orderNumber: await nextOrderNumber(db, T, NOW), retailerId: shopA, placedById: adminId, status: "PLACED", subtotal: 100_000, gstAmount: 0, totalAmount: 100_000, grossAmount: 100_000, createdAt: NOW, items: { create: [{ productId: P.salt, quantity: 2, orderedQty: 2, price: 50_000, gstRate: 0 }] } },
  });
}, 180_000);

function addDayDate(days: number) {
  return new Date(`${addDay(TODAY, days)}T10:00:00+05:30`);
}

afterEach(() => {
  setFakeAi(null);
  process.env.AI_PROVIDER = savedProvider;
});

afterAll(async () => {
  if (T) await purgeTenant(T).catch(() => null);
  if (T2) await purgeTenant(T2).catch(() => null);
  await prisma.$disconnect();
});

describe("A1 reading an order", () => {
  it("reads with the rules when there is no AI", async () => {
    process.env.AI_PROVIDER = "none";
    const r = await readOrder({ tenantId: T, actorId: adminId, retailerId: shopA, text: "5 peti nimbu, 2 jeera" });
    expect(r.source).toBe("rules");
    expect(r.lines.map((l) => [l.productId, l.qty, l.per])).toEqual([
      [P.lemon, 5, "case"],
      [P.jeera, 2, "unit"],
    ]);
  });

  it("lets the AI pick only from the numbered candidates", async () => {
    await useFakeAi();
    let prompt = "";
    setFakeAi(({ prompt: p }) => {
      prompt = p;
      const idx = (name: string) => Number(new RegExp(`(\\d+)\\. ${name.replace(/[()]/g, "\\$&")}`).exec(p)![1]);
      return { data: { lines: [{ said: "bada wala chai", i: idx("Masala Chai 1kg"), qty: 2, per: "unit" }, { said: "kuch aur", i: 99, qty: 1.5, per: "case" }] }, inputTokens: 800, outputTokens: 100 };
    });
    const r = await readOrder({ tenantId: T, actorId: adminId, retailerId: shopA, text: "bada wala chai 2, kuch aur" });
    expect(prompt).toContain("Masala Chai 1kg | मसाला चाय 1 किलो");
    expect(r.source).toBe("ai");
    expect(r.credits).toBeGreaterThan(0);
    expect(r.lines[0]).toMatchObject({ productId: P.chai1k, qty: 2, per: "unit" });
    expect(r.lines[0].confidence).not.toBe("low");
    expect(r.lines[1]).toMatchObject({ productId: null, qty: 2, confidence: "low" }); // out of the list → pick one
  });

  it("falls back to the rules when the AI fails", async () => {
    await useFakeAi();
    setFakeAi(() => ({ refuse: true }));
    const r = await readOrder({ tenantId: T, actorId: adminId, retailerId: shopA, text: "3 namak" });
    expect(r.source).toBe("rules");
    expect(r.note).toMatch(/built-in rules/);
    expect(r.lines[0]).toMatchObject({ productId: P.salt, qty: 3 });
    await setAiPlan(false);
  });
});

describe("A1 orders on WhatsApp", () => {
  it("checks Meta's signature", () => {
    const raw = '{"object":"whatsapp_business_account"}';
    const sig = `sha256=${createHmac("sha256", "s3cret").update(raw).digest("hex")}`;
    expect(validSignature(raw, sig, "s3cret")).toBe(true);
    expect(validSignature(raw, sig, "other")).toBe(false);
    expect(validSignature(raw, null, "s3cret")).toBe(false);
    expect(phone10("919876543210")).toBe("9876543210");
  });

  it("makes a draft from a shop's text, once per message, and replies with a link", async () => {
    process.env.AI_PROVIDER = "none";
    const id = `wamid.${rand()}`;
    const r = await takeWhatsappText({ from: `91${phoneA}`, messageId: id, text: "5 peti nimbu, 2 jeera" }, NOW);
    expect(r).toMatchObject({ status: "draft", tenantId: T, duplicate: false });
    const again = await takeWhatsappText({ from: `91${phoneA}`, messageId: id, text: "5 peti nimbu, 2 jeera" }, NOW);
    expect(again).toMatchObject({ status: "draft", duplicate: true });
    const drafts = await tx((t) => t.orderDraft.findMany({ where: { messageId: id } }));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: "OPEN", retailerId: shopA, source: "rules" });
    const reply = await tx((t) => t.messageLog.findFirst({ where: { event: "reply.order", to: phoneA }, orderBy: { createdAt: "desc" } }));
    expect(reply?.body).toContain("5 pet");
    expect(reply?.link).toContain(`/retailer/catalogue?draft=${drafts[0].id}`);
    expect(whatsappTextBody({ to: phoneA, body: reply!.body })).toMatchObject({ type: "text", to: `91${phoneA}`, text: { body: reply!.body } });

    // The shop opens it, places the order, and the draft is used up.
    const open = await tx((t) => openDraft(t, shopA, drafts[0].id, NOW));
    expect(open).toMatchObject({ status: "OPEN" });
    expect(open!.lines.map((l) => l.productId)).toEqual([P.lemon, P.jeera]);
    expect(await tx((t) => openDraft(t, shopB, drafts[0].id, NOW))).toBeNull(); // another shop can't see it
    const db = tenantDb(T);
    const o = await db.order.create({ data: { orderNumber: await nextOrderNumber(db, T, NOW), retailerId: shopA, placedById: adminId, status: "CANCELLED", subtotal: 0, gstAmount: 0, totalAmount: 0, grossAmount: 0 } });
    expect(await tx((t) => spendDraft(t, shopB, drafts[0].id, o.id, NOW))).toBe(false);
    expect(await tx((t) => spendDraft(t, shopA, drafts[0].id, o.id, NOW))).toBe(true);
    expect(await tx((t) => spendDraft(t, shopA, drafts[0].id, o.id, NOW))).toBe(false);
    expect(await tx((t) => openDraft(t, shopA, drafts[0].id, NOW))).toMatchObject({ status: "USED", orderId: o.id, lines: [] });
  });

  it("ignores strangers, asks for text, respects the switch and expires drafts", async () => {
    expect(await takeWhatsappText({ from: "910000000001", messageId: `wamid.${rand()}`, text: "2 jeera" }, NOW)).toEqual({ status: "unknown_number" });
    expect(await takeWhatsappOther({ from: `91${phoneB}`, messageId: `wamid.${rand()}`, kind: "audio" })).toEqual({ status: "not_text" });
    const asked = await tx((t) => t.messageLog.findFirst({ where: { event: "reply.order", to: phoneB }, orderBy: { createdAt: "desc" } }));
    expect(asked?.body).toMatch(/type the order|use the mic/);

    await setSettings(T, { automation: { orderText: { on: true, whatsapp: false } } });
    expect(await takeWhatsappText({ from: `91${phoneB}`, messageId: `wamid.${rand()}`, text: "2 jeera" }, NOW)).toEqual({ status: "off" });
    await setSettings(T, {});

    const r = await takeWhatsappText({ from: `91${phoneB}`, messageId: `wamid.${rand()}`, text: "2 jeera" }, NOW);
    expect(r.status).toBe("draft");
    const later = new Date(NOW.getTime() + 4 * 86_400_000);
    expect(await tx((t) => openDraft(t, shopB, (r as { draftId: string }).draftId, later))).toMatchObject({ status: "EXPIRED", lines: [] });
    expect(await tx((t) => expireDrafts(t, later))).toBeGreaterThanOrEqual(1);
  });

  it("won't guess between two businesses with the same shop phone", async () => {
    const made = await asPlatform((t) =>
      createTenantRecord(t, { slug: `p13b${rand()}`, name: `Phase 13 other ${rand()}`, stateCode: "09" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: phone() })
    );
    T2 = made.tenant.id;
    const region = await tenantDb(T2).region.create({ data: { name: "Kanpur", areas: { create: [{ name: "South" }] } }, include: { areas: true } });
    await shop(T2, region.areas[0].id, "Shop A elsewhere", phoneA);
    expect(await takeWhatsappText({ from: `91${phoneA}`, messageId: `wamid.${rand()}`, text: "2 jeera" }, NOW)).toEqual({ status: "many_businesses" });
    // Each business sees only its own drafts.
    expect(await withTenantTx(T2, (t) => t.orderDraft.count())).toBe(0);
  });
});

describe("A11 ask your business", () => {
  it("answers dues questions from the books", async () => {
    process.env.AI_PROVIDER = "none";
    const r = await ask({ tenantId: T, actorId: adminId, question: "Who owes more than ₹20,000 for over 30 days?", now: NOW });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answer).toMatchObject({ intent: "dues", source: "rules", params: { minAmount: 2_000_000, minDays: 30 } });
    expect(r.answer.rows.map((x) => x.shop)).toEqual(["Shop A"]);
    expect(r.answer.rows[0]).toMatchObject({ outstanding: 3_000_000, overdue: 3_000_000, days: 40 });
    expect(r.answer.summary).toMatch(/^1 shop owes ₹30,000/);

    const all = await ask({ tenantId: T, actorId: adminId, question: "kiska kitna baki hai", now: NOW });
    expect(all.ok && all.answer.rows.map((x) => x.shop)).toEqual(["Shop A", "Shop B"]);
  });

  it("answers pending orders and says when it can't tell", async () => {
    process.env.AI_PROVIDER = "none";
    const r = await ask({ tenantId: T, actorId: adminId, question: "pending orders", now: NOW });
    expect(r.ok && r.answer.rows.find((x) => x.stage === "New")).toMatchObject({ count: 1, value: 100_000 });
    const no = await ask({ tenantId: T, actorId: adminId, question: "hello there", now: NOW });
    expect(no).toMatchObject({ ok: false });
  });

  it("lets the AI pick a fixed question, never the answer", async () => {
    await useFakeAi();
    setFakeAi(() => ({ data: { intent: "dues", params: { minAmount: 1_000_000, minDays: null, period: null } }, inputTokens: 300, outputTokens: 30 }));
    const r = await ask({ tenantId: T, actorId: adminId, question: "paise kaun nahi de raha zyada", now: NOW });
    expect(r.ok && r.answer).toMatchObject({ intent: "dues", source: "ai", params: { minAmount: 1_000_000 } });
    expect(r.ok && r.answer.rows.map((x) => x.shop)).toEqual(["Shop A"]);

    setFakeAi(() => ({ data: { intent: "drop_tables", params: {} } }));
    const bad = await ask({ tenantId: T, actorId: adminId, question: "something odd", now: NOW });
    expect(bad).toMatchObject({ ok: false });
    await setAiPlan(false);
  });
});
