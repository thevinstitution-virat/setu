/**
 * Phase 12 on a scratch business. "Now" is Thursday 19 Nov 2026, 09:30 IST.
 *
 *   Chai   ordered 5 a day for 8 weeks; 10 in stock; case of 12; supplier takes 3 days.
 *   Salt   ordered 14 every Thursday only; 100 in stock; has an HSN code.
 *   Widget never ordered; no HSN code and no keyword.
 *
 * The scratch business is purged at the end.
 */
import "dotenv/config";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { createTenantRecord } from "@/lib/signup";
import { purgeTenant } from "@/lib/tenant-data";
import type { Ctx } from "@/lib/ledger";
import { nextOrderNumber } from "@/lib/orders";
import { addDay, istDay } from "@/lib/field-math";
import { adjustStock, defaultWarehouse } from "@/lib/stock";
import { invalidateEntitlements } from "@/lib/plans";
import { AUTOMATION_DEFAULTS, type AutomationSettings } from "@/lib/automation-settings";
import { decide, listSuggestions } from "@/lib/automation";
import { forecastTable, loadSheet, reviewReorder } from "@/lib/forecast";
import { aiJson, aiStatus, setFakeAi } from "@/lib/ai";
import { applyCatalogue, missingCounts, runCatalogueAssist } from "@/lib/catalogue-assist";
import * as z from "zod";

const rand = () => Math.random().toString(36).slice(2, 8);
const NOW = new Date("2026-11-19T04:00:00Z");
const TODAY = istDay(NOW);
const TOMORROW = addDay(TODAY, 1);
const ago = (days: number) => new Date(new Date(`${addDay(TODAY, -days)}T00:00:00+05:30`).getTime() + 600 * 60_000);

let T = "";
let adminId = "";
let shopId = "";
let supplierId = "";
const P = { chai: "", salt: "", widget: "" };
const S: AutomationSettings = AUTOMATION_DEFAULTS;
const savedProvider = process.env.AI_PROVIDER;

const tx = <R>(fn: (t: Ctx["tx"]) => Promise<R>) => withTenantTx(T, fn, { timeout: 60_000 });
const ctxRun = <R>(fn: (c: Ctx) => Promise<R>) => withTenantTx(T, (t) => fn({ tx: t, tenantId: T, actorId: adminId }), { timeout: 60_000 });
const admin = () => ({ userId: adminId, role: "ADMIN" as const });
const setSettings = (settings: object) => asPlatform((t) => t.tenant.update({ where: { id: T }, data: { settings } }));
const setAiPlan = async (on: boolean) => {
  await asPlatform((t) => t.tenant.update({ where: { id: T }, data: { overrides: on ? { features: { ai: true } } : {} } }));
  invalidateEntitlements(T);
};

async function order(createdAt: Date, lines: [string, number][], status: "DELIVERED" | "PLACED" | "CANCELLED" = "DELIVERED") {
  const db = tenantDb(T);
  return db.order.create({
    data: {
      orderNumber: await nextOrderNumber(db, T, createdAt),
      retailerId: shopId,
      placedById: adminId,
      status,
      subtotal: 0,
      gstAmount: 0,
      totalAmount: 0,
      grossAmount: 0,
      createdAt,
      items: { create: lines.map(([productId, q]) => ({ productId, quantity: q, orderedQty: q, price: 100, gstRate: 0 })) },
    },
  });
}

beforeAll(async () => {
  const { tenant, user } = await asPlatform((t) =>
    createTenantRecord(t, { slug: `p12${rand()}`, name: `Phase 12 test ${rand()}`, stateCode: "09" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: "9811100012" })
  );
  T = tenant.id;
  adminId = user.id;
  await setSettings({ inventory: { enabled: true } });
  const db = tenantDb(T);
  const region = await db.region.create({ data: { name: "Lucknow", areas: { create: [{ name: "North" }] } }, include: { areas: true } });
  const cat = await db.category.create({ data: { name: "Staples" } });
  supplierId = (await db.supplier.create({ data: { name: "Chai Traders", leadDays: 3 } })).id;
  P.chai = (await db.product.create({ data: { name: "Masala Chai 250g", sku: "MC1", categoryId: cat.id, unit: "pack", price: 10000, mrp: 12000, gstRate: 0, caseUnit: "box", caseSize: 12, lastCost: 8000, supplierId } })).id;
  P.salt = (await db.product.create({ data: { name: "Salt 1kg", sku: "S1", categoryId: cat.id, unit: "pack", price: 2000, mrp: 2500, gstRate: 0, hsnCode: "2501", supplierId } })).id;
  P.widget = (await db.product.create({ data: { name: "Zorbo Widget", sku: "W1", categoryId: cat.id, unit: "piece", price: 500, mrp: 600, gstRate: 18 } })).id;
  const u = await db.user.create({
    data: {
      name: "Shop A",
      phone: `9${String(Date.now()).slice(-9)}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: "Shop A", shopNumber: "1", complexName: "M", pinCode: "226001", areaId: region.areas[0].id } },
    },
    include: { retailerProfile: true },
  });
  shopId = u.retailerProfile!.id;
  for (let d = 56; d >= 1; d--) {
    const day = ago(d);
    const thursday = new Date(day.getTime() + 330 * 60_000).getUTCDay() === 4;
    await order(day, thursday ? [[P.chai, 5], [P.salt, 14]] : [[P.chai, 5]]);
  }
  await order(ago(3), [[P.chai, 500]], "CANCELLED"); // ignored
  await order(NOW, [[P.chai, 3]], "PLACED"); // goes out tomorrow; today is not in the history
  const wh = await ctxRun((c) => defaultWarehouse(c));
  await ctxRun((c) => adjustStock(c, { locationId: wh.id, productId: P.chai, delta: 10, reason: "opening" }));
  await ctxRun((c) => adjustStock(c, { locationId: wh.id, productId: P.salt, delta: 100, reason: "opening" }));
}, 180_000);

afterEach(() => {
  setFakeAi(null);
  process.env.AI_PROVIDER = savedProvider;
});

afterAll(async () => {
  if (T) await purgeTenant(T).catch(() => null);
  await prisma.$disconnect();
});

describe("A6 load sheet", () => {
  it("loads what is booked plus the usual for the day", async () => {
    const s = await ctxRun((c) => loadSheet(c, TOMORROW, NOW, S));
    expect(s.orders).toBe(1);
    expect(s.stockTracked).toBe(true);
    const chai = s.rows.find((r) => r.productId === P.chai)!;
    expect(chai).toMatchObject({ booked: 3, usual: 5, extra: 2, suggested: 5, warehouse: 10, short: 0 }); // 2 extra is under half a case of 12
    // Salt sells on Thursdays only: nothing to load for a Friday.
    expect(s.rows.find((r) => r.productId === P.salt)).toBeUndefined();
    expect(s.totals).toEqual({ booked: 3, extra: 2, short: 0 });
  });

  it("loads only what is booked with the top-up off", async () => {
    const s = await ctxRun((c) => loadSheet(c, TOMORROW, NOW, { ...S, forecast: { ...S.forecast, topUp: false } }));
    expect(s.rows.find((r) => r.productId === P.chai)).toMatchObject({ booked: 3, extra: 0, suggested: 3 });
  });

  it("puts salt on a Thursday sheet", async () => {
    const s = await ctxRun((c) => loadSheet(c, addDay(TODAY, 7), NOW, S));
    expect(s.rows.find((r) => r.productId === P.salt)!.suggested).toBeGreaterThanOrEqual(5);
  });
});

describe("A6 forecast and reorder", () => {
  it("works out days left and what to order", async () => {
    const t = await tx((x) => forecastTable(x, T, NOW, S));
    // 10 in stock less the 3 booked for tomorrow.
    const chai = t.rows.find((r) => r.productId === P.chai)!;
    expect(chai).toMatchObject({ daily: 5, sigma: 0, activeDays: 56, available: 7, daysLeft: 1, runsOut: addDay(TODAY, 1), leadDays: 3, reorderQty: 48, runsOutFirst: true });
    const salt = t.rows.find((r) => r.productId === P.salt)!;
    expect(salt.reorderQty).toBe(0);
    expect(t.rows[0].productId).toBe(P.chai); // fewest days left first
  });

  it("suggests one draft order per supplier and makes it on accept", async () => {
    expect(await ctxRun((c) => reviewReorder(c, NOW, S))).toBe(1);
    expect(await ctxRun((c) => reviewReorder(c, NOW, S))).toBe(0); // one open per supplier
    const list = await tx((t) => listSuggestions(t, admin(), { kind: "reorder" }));
    expect(list.items).toHaveLength(1);
    const s = list.items[0];
    expect(s.subjectId).toBe(supplierId);
    expect((s.payload as { lines: { productId: string; qty: number }[] }).lines).toEqual([expect.objectContaining({ productId: P.chai, qty: 48 })]);
    expect((s.reasons as string[])[0]).toMatch(/run.* out before/);

    const r = await ctxRun((c) => decide(c, admin(), s.id, { accept: true }, NOW));
    expect(r.status).toBe("ACCEPTED");
    const po = await tx((t) => t.purchaseOrder.findFirstOrThrow({ where: { supplierId }, include: { lines: true } }));
    expect(po.status).toBe("DRAFT");
    expect(po.lines).toEqual([expect.objectContaining({ productId: P.chai, quantity: 48, unitCost: 8000 })]);
    expect(istDay(po.expectedDate!)).toBe(addDay(TODAY, 3));

    // The draft now counts as on order: no new reorder.
    const t = await tx((x) => forecastTable(x, T, NOW, S));
    expect(t.rows.find((x) => x.productId === P.chai)).toMatchObject({ onOrder: 48, reorderQty: 0 });
  });

  it("does nothing with the forecast or stock tracking off", async () => {
    expect(await ctxRun((c) => reviewReorder(c, NOW, { ...S, forecast: { ...S.forecast, on: false } }))).toBe(0);
    await setSettings({ inventory: { enabled: false } });
    try {
      expect(await ctxRun((c) => reviewReorder(c, NOW, S))).toBe(0);
      const t = await tx((x) => forecastTable(x, T, NOW, S));
      expect(t.stockTracked).toBe(false);
      expect(t.rows.every((r) => r.available === null && r.reorderQty === 0)).toBe(true);
    } finally {
      await setSettings({ inventory: { enabled: true } });
    }
  });
});

describe("AI gateway", () => {
  const schema = z.object({ answer: z.string() });
  const ask = () => aiJson({ tenantId: T, actorId: adminId, feature: "test.echo", system: "Answer.", prompt: "Call 9876543210 about tea", schema, now: NOW });

  it("says why AI is not available, in order", async () => {
    process.env.AI_PROVIDER = "none";
    expect(await aiStatus(T, NOW)).toMatchObject({ available: false, reason: "no_provider" });
    process.env.AI_PROVIDER = "fake";
    expect(await aiStatus(T, NOW)).toMatchObject({ available: false, reason: "plan" }); // the trial has no AI module
    await setAiPlan(true);
    expect(await aiStatus(T, NOW)).toMatchObject({ available: true, used: 0, cap: null });
    await setSettings({ inventory: { enabled: true }, ai: { on: false } });
    expect(await aiStatus(T, NOW)).toMatchObject({ available: false, reason: "off" });
    await setSettings({ inventory: { enabled: true } });
    expect((await ask()).ok).toBe(false); // no handler
  });

  it("scrubs the prompt, logs the cost and counts credits", async () => {
    process.env.AI_PROVIDER = "fake";
    let seen = "";
    setFakeAi(({ prompt }) => {
      seen = prompt;
      return { data: { answer: "ok" }, inputTokens: 1000, outputTokens: 500 };
    });
    const r = await ask();
    expect(r).toMatchObject({ ok: true, data: { answer: "ok" }, credits: 3 }); // US$0.014 = 123 paise
    expect(seen).not.toContain("9876543210");
    const log = await tx((t) => t.aiCostLog.findMany({ where: { feature: "test.echo" } }));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ provider: "fake", model: "claude-opus-5-5", inputTokens: 1000, outputTokens: 500, costPaise: 123, credits: 3, actorId: adminId });
  });

  it("logs refusals, rejects answers of the wrong shape and stops at the cap", async () => {
    process.env.AI_PROVIDER = "fake";
    setFakeAi(() => ({ refuse: true }));
    expect(await ask()).toMatchObject({ ok: false, reason: "refused" });
    setFakeAi(() => ({ data: { nope: 1 } }));
    expect(await ask()).toMatchObject({ ok: false, reason: "error" });
    const used = (await aiStatus(T, NOW)).used;
    expect(used).toBe(6); // 3 + 1 for the refusal + 2 for the bad answer
    await setSettings({ inventory: { enabled: true }, ai: { on: true, monthlyCredits: 6 } });
    expect(await aiStatus(T, NOW)).toMatchObject({ available: false, reason: "cap", used: 6, cap: 6 });
    expect(await ask()).toMatchObject({ ok: false, reason: "cap" });
    await setSettings({ inventory: { enabled: true } });
  });
});

describe("A13 catalogue assist", () => {
  it("counts what is missing", async () => {
    expect(await missingCounts(T)).toEqual({ nameHi: 3, hsn: 2 });
  });

  it("proposes HSN codes by the rules, with the business's own table deciding the rate", async () => {
    process.env.AI_PROVIDER = "none";
    await tx((t) => t.hsnCode.create({ data: { code: "0902", gstRate: 18, description: "Tea (own table)" } }));
    const r = await runCatalogueAssist(T, adminId, "hsn", { now: NOW });
    expect(r).toMatchObject({ looked: 2, made: 2, credits: 0, source: "rules" });
    expect(r.note).toMatch(/AI isn't set up/);
    const list = await tx((t) => listSuggestions(t, admin(), { kind: "catalogue" }));
    const chai = list.items.find((i) => i.subjectId === P.chai)!;
    expect(chai.payload).toMatchObject({ field: "hsn", proposed: { hsnCode: "0902", gstRate: 18 }, source: "rules" });
    // No keyword for the widget: the code its category uses most.
    expect(list.items.find((i) => i.subjectId === P.widget)!.payload).toMatchObject({ proposed: { hsnCode: "2501", gstRate: 0 }, confidence: "low" });
    // A second run skips products with a suggestion waiting.
    expect((await runCatalogueAssist(T, adminId, "hsn", { now: NOW })).looked).toBe(0);
    // Kept off the main inbox.
    const inbox = await tx((t) => listSuggestions(t, admin()));
    expect(inbox.items.some((i) => i.kind === "catalogue")).toBe(false);

    // Accept with an edit: the table still sets the rate.
    await ctxRun((c) => decide(c, admin(), chai.id, { accept: true, edit: { hsnCode: "0902", gstRate: 5 } }, NOW));
    const p = await tx((t) => t.product.findUniqueOrThrow({ where: { id: P.chai } }));
    expect(p).toMatchObject({ hsnCode: "0902", gstRate: 18 });
  });

  it("checks edits before writing", async () => {
    await expect(ctxRun((c) => applyCatalogue(c, { field: "hsn", productId: P.widget, proposed: { hsnCode: "12", gstRate: 18 } }))).rejects.toThrow(/4 to 8 digits/);
    await expect(ctxRun((c) => applyCatalogue(c, { field: "hsn", productId: P.widget, proposed: { hsnCode: "8205", gstRate: 7 } }))).rejects.toThrow(/GST must be/);
    await expect(ctxRun((c) => applyCatalogue(c, { field: "nameHi", productId: P.widget, proposed: { nameHi: "" } }))).rejects.toThrow(/Hindi name/);
  });

  it("writes Hindi names with AI when available, falling back to the rules for what it skips", async () => {
    process.env.AI_PROVIDER = "fake";
    await setAiPlan(true);
    setFakeAi(({ feature, prompt }) => {
      expect(feature).toBe("catalogue.name_hi");
      const lines = prompt.split("\n").filter((l) => /^\d+\. /.test(l));
      // Answers all but the widget; one answer has English letters and is dropped.
      return {
        data: {
          items: lines.flatMap((l, i) => (l.includes("Widget") ? [] : [{ i, nameHi: l.includes("Chai") ? "मसाला चाय 250 ग्राम" : "Salt नमक" }])),
        },
      };
    });
    const r = await runCatalogueAssist(T, adminId, "nameHi", { now: NOW });
    expect(r).toMatchObject({ looked: 3, made: 3, credits: 2, source: "ai", note: null });
    const items = (await tx((t) => listSuggestions(t, admin(), { kind: "catalogue" }))).items.filter((i) => (i.payload as { field: string }).field === "nameHi");
    const by = (id: string) => items.find((i) => i.subjectId === id)!.payload as { source: string; proposed: { nameHi: string } };
    expect(by(P.chai)).toMatchObject({ source: "ai", proposed: { nameHi: "मसाला चाय 250 ग्राम" } });
    expect(by(P.salt).source).toBe("rules");
    expect(by(P.widget).source).toBe("rules");

    const chai = items.find((i) => i.subjectId === P.chai)!;
    await ctxRun((c) => decide(c, admin(), chai.id, { accept: true, edit: { nameHi: "मसाला चाय (250 ग्राम)" } }, NOW));
    expect((await tx((t) => t.product.findUniqueOrThrow({ where: { id: P.chai } }))).nameHi).toBe("मसाला चाय (250 ग्राम)");
  });

  it("falls back to the rules when the AI call fails", async () => {
    process.env.AI_PROVIDER = "fake";
    setFakeAi(() => ({ refuse: true }));
    await tx((t) => t.suggestion.updateMany({ where: { kind: "catalogue", status: "OPEN" }, data: { status: "EXPIRED" } }));
    const r = await runCatalogueAssist(T, adminId, "hsn", { now: NOW });
    expect(r.source).toBe("mixed");
    expect(r.note).toMatch(/declined.*built-in rules/);
  });
});
