/**
 * Phase 14 on a scratch business: A3 payment proofs, A8 delivery and pickup
 * photos, A10 shelf audits. Photos are tiny made-up JPEG bytes put in
 * storage; the AI is the "fake" provider. Both scratch businesses are purged
 * at the end (with their files).
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { createTenantRecord } from "@/lib/signup";
import { purgeTenant } from "@/lib/tenant-data";
import { nextOrderNumber } from "@/lib/orders";
import { addDay, istDay } from "@/lib/field-math";
import { invalidateEntitlements } from "@/lib/plans";
import { setFakeAi } from "@/lib/ai";
import { newKey, putFile } from "@/lib/storage";
import { checkSubject, checksFor, readShelf, sweepPhotos, viewOf } from "@/lib/photo-checks";
import { saveShelfAudit, shelfReport } from "@/lib/shelf";
import { MoneyError } from "@/lib/money-error";

const rand = () => Math.random().toString(36).slice(2, 8);
const NOW = new Date("2026-11-19T04:00:00Z");
const TODAY = istDay(NOW);
const phone = () => `7${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);

let T = "";
let T2 = "";
let adminId = "";
let shopA = "";
let agentId = "";
let crate = "";
let area = "";
const P = { tea: "", salt: "" };
const savedProvider = process.env.AI_PROVIDER;
let n = 0;

const tx = <R,>(fn: (t: Parameters<Parameters<typeof withTenantTx>[1]>[0]) => Promise<R>) => withTenantTx(T, fn, { timeout: 60_000 });
const setAutomation = (id: string, automation: object) => asPlatform((t) => t.tenant.update({ where: { id }, data: { settings: { automation } } }));
const useFakeAi = async () => {
  process.env.AI_PROVIDER = "fake";
  await asPlatform((t) => t.tenant.update({ where: { id: T }, data: { overrides: { features: { ai: true } } } }));
  invalidateEntitlements(T);
};
async function photo(tenantId: string, kind: string, bytes = jpeg()) {
  const key = newKey(tenantId, kind, "image/jpeg");
  await putFile(key, bytes, "image/jpeg");
  return { key, bytes };
}
async function payment(o: { amount: number; reference?: string | null; proofKey: string; method?: "UPI" | "BANK" | "CHEQUE" }) {
  return tenantDb(T).payment.create({
    data: { number: `PAY-T${++n}`, retailerId: shopA, method: o.method ?? "UPI", state: "PENDING_VERIFICATION", amount: o.amount, reference: o.reference ?? null, proofKey: o.proofKey, collectedAt: NOW },
  });
}
const checks = (subjectId: string) => tx((t) => t.suggestion.findMany({ where: { kind: "check", subjectId }, select: { title: true, payload: true, reasons: true } }));

beforeAll(async () => {
  const made = await asPlatform((t) =>
    createTenantRecord(t, { slug: `p14${rand()}`, name: `Phase 14 test ${rand()}`, stateCode: "09" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: phone() })
  );
  T = made.tenant.id;
  adminId = made.user.id;
  const db = tenantDb(T);
  const region = await db.region.create({ data: { name: "Lucknow", areas: { create: [{ name: "North" }] } }, include: { areas: true } });
  area = region.areas[0].id;
  const cat = await db.category.create({ data: { name: "Grocery" } });
  P.tea = (await db.product.create({ data: { name: "Masala Chai 250g", sku: "CH250", categoryId: cat.id, unit: "pack", price: 5000, mrp: 6000, gstRate: 5 } })).id;
  P.salt = (await db.product.create({ data: { name: "Salt 1kg", sku: "SLT1", categoryId: cat.id, unit: "pack", price: 2000, mrp: 2500, gstRate: 0 } })).id;
  const u = await db.user.create({
    data: { name: "Shop A", phone: phone(), role: "RETAILER", retailerProfile: { create: { outletName: "Shop A", shopNumber: "1", complexName: "M", pinCode: "226001", areaId: area } } },
    include: { retailerProfile: true },
  });
  shopA = u.retailerProfile!.id;
  const driver = await db.user.create({ data: { name: "Driver D", phone: phone(), role: "DELIVERY_AGENT", deliveryAgentProfile: { create: {} } }, include: { deliveryAgentProfile: true } });
  agentId = driver.deliveryAgentProfile!.id;
  crate = (await db.returnable.create({ data: { name: "Crate 24" } })).id;
  await db.order.create({
    data: { orderNumber: await nextOrderNumber(db, T, NOW), retailerId: shopA, placedById: adminId, status: "DELIVERED", subtotal: 100_000, gstAmount: 0, totalAmount: 100_000, grossAmount: 100_000, createdAt: new Date(`${addDay(TODAY, -20)}T10:00:00+05:30`), items: { create: [{ productId: P.tea, quantity: 5, orderedQty: 5, price: 20_000, gstRate: 0 }] } },
  });
}, 180_000);

afterEach(() => {
  setFakeAi(null);
  process.env.AI_PROVIDER = savedProvider;
});

afterAll(async () => {
  if (T) await purgeTenant(T).catch(() => null);
  if (T2) await purgeTenant(T2).catch(() => null);
  await prisma.$disconnect();
});

describe("A3 payment proofs", () => {
  it("without AI only checks for reuse, and catches the same photo twice", async () => {
    process.env.AI_PROVIDER = "none";
    const first = await photo(T, "payment-proof");
    const p1 = await payment({ amount: 500_000, reference: "111122223333", proofKey: first.key });
    const c1 = await checkSubject(T, "payment", p1.id, { now: NOW });
    expect(c1).toMatchObject({ source: "rules", verdict: "ok", flags: [] });
    expect(viewOf(c1!).summary).toBe("Checked for reuse only");

    // The same picture uploaded again (new key, same bytes) for another payment.
    const again = await photo(T, "payment-proof", first.bytes);
    const p2 = await payment({ amount: 700_000, reference: "444455556666", proofKey: again.key });
    const c2 = await checkSubject(T, "payment", p2.id, { now: NOW });
    expect(c2).toMatchObject({ verdict: "bad", flags: ["reused"] });
    const s = await checks(p2.id);
    expect(s).toHaveLength(1);
    expect(s[0].title).toMatch(/^Same photo used twice: PAY-T\d+ from Shop A \(₹7,000\)$/);
    expect(s[0].payload).toMatchObject({ check: "photo_reused", photoKey: again.key });

    // Checked once per photo; a second call returns the saved row.
    const c2b = await checkSubject(T, "payment", p2.id, { now: NOW });
    expect(c2b!.id).toBe(c2!.id);
    expect(await checks(p1.id)).toHaveLength(0);
  });

  it("catches the same UTR on two payments", async () => {
    process.env.AI_PROVIDER = "none";
    const a = await payment({ amount: 100_000, reference: "UTR777788889999", proofKey: (await photo(T, "payment-proof")).key });
    const b = await payment({ amount: 100_000, reference: "utr777788889999", proofKey: (await photo(T, "payment-proof")).key });
    await checkSubject(T, "payment", a.id, { now: NOW });
    const c = await checkSubject(T, "payment", b.id, { now: NOW });
    expect(c!.flags).toContain("reference_reused");
    expect((await checks(b.id))[0].payload).toMatchObject({ check: "reference_reused" });
    // A rejected payment's UTR doesn't count.
    await tenantDb(T).payment.update({ where: { id: a.id }, data: { state: "REJECTED" } });
    const again = await checkSubject(T, "payment", b.id, { now: NOW, force: true });
    expect(again!.flags).not.toContain("reference_reused");
  });

  it("reads the screenshot with AI and compares it with the entry", async () => {
    await useFakeAi();
    let seen: { images: number; prompt: string } | null = null;
    let amount = 5000;
    setFakeAi(({ feature, images, prompt }) => {
      if (feature !== "photo.payment") return { refuse: true };
      seen = { images, prompt };
      return { data: { readable: true, kind: "upi", amount, reference: "T2611 1912 3456", date: TODAY, status: "success", chequeNumber: null, signed: null } };
    });
    const ok = await payment({ amount: 500_000, reference: "T261119123456", proofKey: (await photo(T, "payment-proof")).key });
    const c = await checkSubject(T, "payment", ok.id, { now: NOW });
    expect(c).toMatchObject({ source: "ai", verdict: "ok" });
    expect(c!.credits).toBeGreaterThan(0);
    expect(viewOf(c!).summary).toBe("Screenshot matches: ₹5,000 · UTR T261119123456 · 19 Nov");
    expect(seen!.images).toBe(1);
    // The AI isn't told what was entered or who paid.
    expect(seen!.prompt).not.toMatch(/T261119123456|Shop A/);

    amount = 500;
    const off = await payment({ amount: 500_000, reference: "T261119123456X", proofKey: (await photo(T, "payment-proof")).key });
    const c2 = await checkSubject(T, "payment", off.id, { now: NOW });
    expect(c2).toMatchObject({ verdict: "bad" });
    expect(c2!.flags).toEqual(expect.arrayContaining(["amount_differs"]));
    expect(viewOf(c2!).notes[0]).toBe("The photo shows ₹500; entered ₹5,000.");
    // A wrong amount is a note in the queue, not a Suggestion.
    expect(await checks(off.id)).toHaveLength(0);

    const log = await tx((t) => t.aiCostLog.count({ where: { feature: "photo.payment" } }));
    expect(log).toBe(2);

    // The queue sees the latest photo's check.
    const map = await checksFor(T, "payment", [{ id: ok.id, key: ok.proofKey }, { id: off.id, key: "t/other" }]);
    expect(map.get(ok.id)?.verdict).toBe("ok");
    expect(map.has(off.id)).toBe(false);
  });

  it("doesn't send payment photos when that reading is off", async () => {
    await useFakeAi();
    let calls = 0;
    setFakeAi(() => {
      calls++;
      return { refuse: true };
    });
    await setAutomation(T, { photos: { on: true, payments: false, delivery: true } });
    const p = await payment({ amount: 100_000, reference: null, proofKey: (await photo(T, "payment-proof")).key });
    const c = await checkSubject(T, "payment", p.id, { now: NOW });
    expect(c!.source).toBe("rules");
    expect(calls).toBe(0);
    await setAutomation(T, {});
  });
});

describe("A8 delivery and pickup photos", () => {
  it("turns a blank delivery photo into a check", async () => {
    await useFakeAi();
    setFakeAi(({ feature }) => (feature === "photo.delivery" ? { data: { readable: true, blank: true, showsShop: false, showsGoods: false, note: "A dark pocket." } } : { refuse: true }));
    const db = tenantDb(T);
    const order = await db.order.create({
      data: { orderNumber: await nextOrderNumber(db, T, NOW), retailerId: shopA, placedById: adminId, status: "DELIVERED", subtotal: 50_000, gstAmount: 0, totalAmount: 50_000, grossAmount: 50_000, createdAt: NOW, items: { create: [{ productId: P.salt, quantity: 1, orderedQty: 1, price: 50_000, gstRate: 0 }] } },
    });
    const d = await db.delivery.create({ data: { orderId: order.id, deliveryAgentId: agentId, state: "DELIVERED", deliveredAt: NOW, podPhotoUrl: (await photo(T, "pod-photo")).key } });
    const c = await checkSubject(T, "delivery", d.id, { now: NOW });
    expect(c).toMatchObject({ source: "ai", verdict: "warn", flags: ["blank"] });
    const s = await checks(d.id);
    expect(s).toHaveLength(1);
    expect(s[0].title).toBe(`Delivery photo doesn't show the drop: ${order.orderNumber} to Shop A (Driver D)`);
    expect(s[0].reasons).toEqual(["Blank or dark photo"]);
  });

  it("compares crates in a pickup photo with the count entered", async () => {
    await useFakeAi();
    let crates = 6;
    setFakeAi(({ feature, prompt }) => {
      expect(prompt).toContain('"Crate 24"');
      return feature === "photo.pickup" ? { data: { readable: true, crates } } : { refuse: true };
    });
    const db = tenantDb(T);
    const m1 = await db.returnableMove.create({ data: { returnableId: crate, retailerId: shopA, kind: "PICKUP", taken: 10, photoKey: (await photo(T, "pod-photo")).key, createdAt: NOW } });
    expect(await checkSubject(T, "pickup", m1.id, { now: NOW })).toMatchObject({ verdict: "bad", flags: ["crates_differ"] });
    expect((await checks(m1.id))[0].payload).toMatchObject({ check: "crates_mismatch" });
    crates = 9;
    const m2 = await db.returnableMove.create({ data: { returnableId: crate, retailerId: shopA, kind: "PICKUP", taken: 10, photoKey: (await photo(T, "pod-photo")).key, createdAt: NOW } });
    expect(await checkSubject(T, "pickup", m2.id, { now: NOW })).toMatchObject({ verdict: "ok" });
    expect(await checks(m2.id)).toHaveLength(0);
    // Two crate types picked up with one photo: one row each, same upload, not a reuse.
    const m3 = await db.returnableMove.create({ data: { returnableId: crate, retailerId: shopA, kind: "PICKUP", taken: 9, photoKey: m2.photoKey, createdAt: NOW } });
    expect(await checkSubject(T, "pickup", m3.id, { now: NOW })).toMatchObject({ verdict: "ok", flags: [] });
  });

  it("sweeps photos not checked yet, once", async () => {
    process.env.AI_PROVIDER = "none";
    await payment({ amount: 200_000, reference: null, proofKey: (await photo(T, "payment-proof")).key });
    const first = await sweepPhotos(T, { now: NOW });
    expect(first.checked).toBeGreaterThanOrEqual(1);
    expect((await sweepPhotos(T, { now: NOW })).checked).toBe(0);
  });
});

describe("A10 shelf audits", () => {
  it("reads counts from a shelf photo, only from our product list", async () => {
    await useFakeAi();
    let prompt = "";
    setFakeAi(({ feature, prompt: p }) => {
      prompt = p;
      return feature === "photo.shelf" ? { data: { readable: true, ours: 6, others: 14, empty: 2, seen: [1, 1, 99], note: "Ours on the second shelf." } } : { refuse: true };
    });
    const { key } = await photo(T, "shelf-photo");
    const r = await readShelf(T, { actorId: adminId, retailerId: shopA, photoKey: key, now: NOW });
    expect(prompt).toContain("1. Masala Chai 250g"); // bought by this shop: listed first
    expect(r).toEqual({ ok: true, read: { ours: 6, others: 14, empty: 2, seen: [{ id: P.tea, name: "Masala Chai 250g" }], note: "Ours on the second shelf." }, credits: expect.any(Number) });

    await setAutomation(T, { shelf: { on: false } });
    expect(await readShelf(T, { actorId: adminId, retailerId: shopA, photoKey: key, now: NOW })).toEqual({ ok: false, message: "Shelf audits are turned off in Settings → Automation" });
    await setAutomation(T, {});
    process.env.AI_PROVIDER = "none";
    expect((await readShelf(T, { actorId: adminId, retailerId: shopA, photoKey: key, now: NOW })).ok).toBe(false);
  });

  it("saves audits, marks who counted, and reports share against the audit before", async () => {
    const k1 = (await photo(T, "shelf-photo")).key;
    const k2 = (await photo(T, "shelf-photo")).key;
    const a1 = await tx((t) => saveShelfAudit(t, T, adminId, { retailerId: shopA, photoKey: k1, ours: 4, others: 16, empty: 0 }));
    expect(a1.source).toBe("manual");
    await tx((t) => t.shelfAudit.update({ where: { id: a1.id }, data: { createdAt: new Date(Date.now() - 10 * 86_400_000) } }));
    const a2 = await tx((t) => saveShelfAudit(t, T, adminId, { retailerId: shopA, photoKey: k2, ours: 7, others: 13, empty: 3, seen: [P.tea, "nope"], read: { ours: 6, others: 14, empty: 3 } }));
    expect(a2).toMatchObject({ source: "ai_edited", seen: [P.tea] });

    await expect(tx((t) => saveShelfAudit(t, T, adminId, { retailerId: shopA, photoKey: k2, ours: 1001, others: 0, empty: 0 }))).rejects.toThrow(MoneyError);
    const pod = (await photo(T, "pod-photo")).key;
    await expect(tx((t) => saveShelfAudit(t, T, adminId, { retailerId: shopA, photoKey: pod, ours: 1, others: 0, empty: 0 }))).rejects.toThrow("Take a photo of the shelf first");

    const r = await tx((t) => shelfReport(t, { from: addDay(istDay(), -12), to: istDay(), days: 13 } as never));
    expect(r).toMatchObject({ audits: 2, shops: 1, avgShare: 35, emptySlots: 3, shopsWithEmpty: 1 });
    expect(r.rows[0]).toMatchObject({ outletName: "Shop A", ours: 7, share: 35, prevShare: 20, change: 15, source: "ai_edited" });
    expect(r.seen).toEqual([{ name: "Masala Chai 250g", shops: 1 }]);
  });
});

describe("isolation", () => {
  it("keeps photo checks and shelf audits inside each business", async () => {
    process.env.AI_PROVIDER = "none";
    const made = await asPlatform((t) =>
      createTenantRecord(t, { slug: `p14b${rand()}`, name: `Phase 14 other ${rand()}`, stateCode: "09" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: phone() })
    );
    T2 = made.tenant.id;
    const db2 = tenantDb(T2);
    const region = await db2.region.create({ data: { name: "Kanpur", areas: { create: [{ name: "South" }] } }, include: { areas: true } });
    const u = await db2.user.create({
      data: { name: "Shop Z", phone: phone(), role: "RETAILER", retailerProfile: { create: { outletName: "Shop Z", shopNumber: "1", complexName: "M", pinCode: "208001", areaId: region.areas[0].id } } },
      include: { retailerProfile: true },
    });
    expect(await withTenantTx(T2, (t) => t.photoCheck.count())).toBe(0);
    expect(await withTenantTx(T2, (t) => t.shelfAudit.count())).toBe(0);

    // A photo used at the first business is not "reused" at the second.
    const used = await tx((t) => t.photoCheck.findFirstOrThrow({ where: { subjectType: "payment" }, select: { fileKey: true } }));
    const bytes = (await (await import("@/lib/storage")).getFile(used.fileKey))!.bytes;
    const key = newKey(T2, "payment-proof", "image/jpeg");
    await putFile(key, bytes, "image/jpeg");
    const p = await db2.payment.create({ data: { number: "PAY-Z1", retailerId: u.retailerProfile!.id, method: "UPI", state: "PENDING_VERIFICATION", amount: 100, proofKey: key, collectedAt: NOW } });
    expect((await checkSubject(T2, "payment", p.id, { now: NOW }))!.flags).toEqual([]);

    // A photo key from the first business can't be checked or read at the second.
    expect(await readShelf(T2, { actorId: made.user.id, retailerId: u.retailerProfile!.id, photoKey: used.fileKey, now: NOW })).toEqual({ ok: false, message: "That photo isn't from this business" });
  });
});
