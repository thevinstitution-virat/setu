/**
 * Phase 11 automations on a scratch business with a known history, posted
 * through the real ledger. "Now" is Thursday 19 Nov 2026, 09:30 IST.
 *
 *   A  on Thursday's beat; orders weekly (P1 ×5, P2 ×2); one bill 13 days overdue.
 *   B  ordered weekly until 30 days ago: at risk.
 *   C  orders weekly, last 2 days ago: steady; found closed three times.
 *   D  one order 43 days ago, unpaid: 35 days late.
 *   E  weekly ₹5,000 orders paid at the door; limit ₹2,000, 15 credit days.
 *
 * The scratch business is purged at the end.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { createTenantRecord } from "@/lib/signup";
import { purgeTenant } from "@/lib/tenant-data";
import { bookSale, onOrderDelivered, recordPayment, withMoney, MoneyError, type Ctx } from "@/lib/ledger";
import { nextOrderNumber } from "@/lib/orders";
import { addDay, istDay } from "@/lib/field-math";
import { dayRoute } from "@/lib/field";
import { AUTOMATION_DEFAULTS, automationSettings, parseAutomationSettings, type AutomationSettings } from "@/lib/automation-settings";
import { decide, kindsFor, listSuggestions, planTrips, planVisits, recordAiUse, reviewCollections, reviewCredit, runChecks, runFeature, usualOrderFor, type PlanShop } from "@/lib/automation";

const rand = () => Math.random().toString(36).slice(2, 8);
const NOW = new Date("2026-11-19T04:00:00Z");
const TODAY = istDay(NOW); // 2026-11-19, a Thursday
const ago = (days: number, minutes = 600) => new Date(new Date(`${addDay(TODAY, -days)}T00:00:00+05:30`).getTime() + minutes * 60_000);

let T = "";
let adminId = "";
let agentId = "";
let agentUserId = "";
let supervisorId = "";
const drivers: { id: string; userId: string }[] = [];
const P: Record<"P1" | "P2", string> = { P1: "", P2: "" };
const shop: Record<"A" | "B" | "C" | "D" | "E", string> = { A: "", B: "", C: "", D: "", E: "" };
const S: AutomationSettings = AUTOMATION_DEFAULTS;

const tx = <R>(fn: (t: Ctx["tx"]) => Promise<R>) => withTenantTx(T, fn, { timeout: 60_000 });
const ctxRun = <R>(fn: (c: Ctx) => Promise<R>) => withTenantTx(T, (t) => fn({ tx: t, tenantId: T, actorId: null }), { timeout: 60_000 });
const admin = () => ({ userId: adminId, role: "ADMIN" as const });

async function sell(o: { shop: string; daysAgo: number; lines: [string, number, number][]; paid: boolean; deliverAfter?: number; lat?: number; lng?: number }) {
  const db = tenantDb(T);
  const total = o.lines.reduce((a, [, q, price]) => a + q * price, 0);
  const deliveredAt = ago(o.daysAgo - (o.deliverAfter ?? 1), 660);
  const order = await db.order.create({
    data: {
      orderNumber: await nextOrderNumber(db, T, ago(o.daysAgo)),
      retailerId: o.shop,
      placedById: agentUserId,
      status: "DELIVERED",
      subtotal: total,
      gstAmount: 0,
      totalAmount: total,
      grossAmount: total,
      createdAt: ago(o.daysAgo),
      items: { create: o.lines.map(([productId, quantity, price]) => ({ productId, quantity, orderedQty: quantity, deliveredQty: quantity, price, gstRate: 0 })) },
      delivery: { create: { deliveryAgentId: drivers[0].id, paymentMethod: "CASH", paymentStatus: "PENDING", codAmount: total, seq: 1, state: "DELIVERED", deliveredAt, lat: o.lat, lng: o.lng } },
    },
  });
  await withMoney(T, drivers[0].userId, async (ctx) => {
    await bookSale(ctx, order.id, deliveredAt);
    await onOrderDelivered(ctx, order, o.paid ? { amount: total, method: "UPI", reference: null, collectorId: drivers[0].userId, occurredAt: deliveredAt } : null);
  });
  return order;
}

beforeAll(async () => {
  const { tenant, user } = await asPlatform((t) =>
    createTenantRecord(t, { slug: `p11${rand()}`, name: `Phase 11 test ${rand()}`, stateCode: "09" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: "9811100011" })
  );
  T = tenant.id;
  adminId = user.id;
  await asPlatform((t) => t.tenant.update({ where: { id: T }, data: { settings: { delivery: { depot: { lat: 26.85, lng: 80.95 } } } } }));
  const db = tenantDb(T);
  const region = await db.region.create({ data: { name: "Lucknow", areas: { create: [{ name: "North" }, { name: "South" }] } }, include: { areas: true } });
  const north = region.areas.find((a) => a.name === "North")!;
  const south = region.areas.find((a) => a.name === "South")!;
  const cat = await db.category.create({ data: { name: "Staples" } });
  P.P1 = (await db.product.create({ data: { name: "Rice 1kg", sku: "R1", categoryId: cat.id, unit: "pack", price: 10000, mrp: 12000, gstRate: 0 } })).id;
  P.P2 = (await db.product.create({ data: { name: "Salt 1kg", sku: "S1", categoryId: cat.id, unit: "pack", price: 5000, mrp: 6000, gstRate: 0 } })).id;
  const agent = await db.user.create({ data: { name: "Ravi", loginId: "ravi", passwordHash: "x", role: "SALES_AGENT", salesAgentProfile: { create: {} } }, include: { salesAgentProfile: true } });
  agentUserId = agent.id;
  agentId = agent.salesAgentProfile!.id;
  supervisorId = (await db.user.create({ data: { name: "Sup", loginId: "sup", passwordHash: "x", role: "SUPERVISOR" } })).id;
  for (const n of ["Amit", "Bala"]) {
    const d = await db.user.create({ data: { name: n, loginId: n.toLowerCase(), passwordHash: "x", role: "DELIVERY_AGENT", deliveryAgentProfile: { create: {} } }, include: { deliveryAgentProfile: true } });
    drivers.push({ id: d.deliveryAgentProfile!.id, userId: d.id });
  }
  const pins = { A: [26.9, 80.94], B: [26.91, 80.96], C: [26.8, 80.94], D: [26.79, 80.97], E: [26.81, 80.96] } as const;
  for (const [k, i] of [["A", 1], ["B", 2], ["C", 3], ["D", 4], ["E", 5]] as const) {
    const u = await db.user.create({
      data: {
        name: `Shop ${k}`,
        phone: `9${String(Date.now()).slice(-6)}${i}${Math.floor(Math.random() * 10)}${Math.floor(Math.random() * 10)}`.slice(0, 10),
        role: "RETAILER",
        retailerProfile: {
          create: {
            outletName: `Shop ${k}`,
            shopNumber: String(i),
            complexName: "M",
            pinCode: "226001",
            areaId: "AB".includes(k) ? north.id : south.id,
            salesAgentId: agentId,
            lat: pins[k][0],
            lng: pins[k][1],
            ...(k === "E" ? { creditLimit: 200_000, creditDays: 15 } : {}),
          },
        },
      },
      include: { retailerProfile: true },
    });
    shop[k] = u.retailerProfile!.id;
  }
  // Thursday's beat has only A.
  const beat = await db.beat.create({ data: { name: "Thursday north", salesAgentId: agentId, areaId: north.id, weekdays: [4], active: true } });
  await db.beatRetailer.create({ data: { beatId: beat.id, retailerId: shop.A, seq: 1 } });

  const usual: [string, number, number][] = [
    [P.P1, 5, 10000],
    [P.P2, 2, 5000],
  ];
  for (const d of [28, 21, 14, 7]) await sell({ shop: shop.A, daysAgo: d, lines: usual, paid: d !== 21 });
  for (const d of [58, 51, 44, 37, 30]) await sell({ shop: shop.B, daysAgo: d, lines: [[P.P1, 3, 10000]], paid: true });
  for (const d of [16, 9, 2]) await sell({ shop: shop.C, daysAgo: d, lines: [[P.P2, 4, 5000]], paid: true });
  await sell({ shop: shop.D, daysAgo: 43, lines: [[P.P1, 8, 10000]], paid: false });
  for (let d = 85; d >= 1; d -= 7) {
    // The last one (yesterday) was marked delivered about 2 km from E's pin.
    await sell({ shop: shop.E, daysAgo: d, lines: [[P.P1, 50, 10000]], paid: true, ...(d === 1 ? { deliverAfter: 0, lat: 26.83, lng: 80.96 } : {}) });
  }
}, 180_000);

afterAll(async () => {
  if (T) await purgeTenant(T).catch(() => null);
  await prisma.$disconnect();
});

describe("settings and who decides", () => {
  it("merges saved settings over the defaults and checks what is saved", () => {
    expect(automationSettings({ automation: { visitPlan: { auto: true } } }).visitPlan).toEqual({ ...AUTOMATION_DEFAULTS.visitPlan, auto: true });
    expect(parseAutomationSettings({ checks: { farMetres: 10 } })).toMatch(/50 to 5000/);
    expect(parseAutomationSettings({ collections: { visitAfterDays: 30, stopAfterDays: 20 } })).toMatch(/after the collection visit/);
    expect(parseAutomationSettings({ credit: { on: "yes" } })).toMatch(/on or off/);
    expect(parseAutomationSettings({ tripPlan: { maxDrops: 10 } })).toEqual({ tripPlan: { on: true, maxDrops: 10 } });
  });

  it("gives each role only the kinds it may decide", () => {
    expect(kindsFor("ADMIN")).toHaveLength(8);
    expect(kindsFor("SUPERVISOR")).toEqual(["visit_plan"]);
    expect(kindsFor("SALES_AGENT")).toEqual([]);
  });
});

describe("usual order", () => {
  it("finds A's usual products and quantities", async () => {
    const u = await tx((t) => usualOrderFor(t, shop.A, NOW));
    expect(u.basedOn).toBe(4);
    expect(u.lines).toEqual([
      { productId: P.P1, qty: 5, times: 4, of: 4 },
      { productId: P.P2, qty: 2, times: 4, of: 4 },
    ]);
  });
});

describe("visit plan", () => {
  let id = "";

  it("adds the at-risk and late-paying shops to the day, and marks A on the beat to collect", async () => {
    expect(await ctxRun((c) => planVisits(c, TODAY, NOW, S))).toBe(1);
    const s = await tx((t) => t.suggestion.findFirstOrThrow({ where: { kind: "visit_plan" } }));
    id = s.id;
    const shops = (s.payload as { shops: PlanShop[] }).shops;
    expect(shops.map((x) => [x.name, x.onRoute])).toEqual([
      ["Shop A", true],
      ["Shop D", false],
      ["Shop B", false],
    ]);
    expect(shops[0].reasons).toContain("overdue");
    expect(shops[1].reasons).toEqual(["at_risk", "overdue"]);
    expect(shops[2].reasons).toEqual(["at_risk"]);
    expect(s.title).toBe("Ravi: 2 extra shops to visit, 2 to collect from");
    expect(await ctxRun((c) => planVisits(c, TODAY, NOW, S))).toBe(0); // once a day
  });

  it("hides it from a supervisor outside the team", async () => {
    const list = await tx((t) => listSuggestions(t, { userId: supervisorId, role: "SUPERVISOR" }));
    expect(list.items).toHaveLength(0);
    await expect(ctxRun((c) => decide(c, { userId: supervisorId, role: "SUPERVISOR" }, id, { accept: true }, NOW))).rejects.toThrow(/can't decide/);
  });

  it("puts the kept shops on the agent's route when accepted", async () => {
    const r = await ctxRun((c) => decide(c, admin(), id, { accept: true, retailerIds: [shop.A, shop.B] }, NOW));
    expect(r.status === "ACCEPTED" && r.result).toMatchObject({ tasks: 2 });
    const route = await tx((t) => dayRoute(t, T, agentId, TODAY));
    expect(route.route.map((x) => [x.retailer.outletName, x.reasons])).toEqual([["Shop A", ["due", "overdue"]]]);
    expect(route.extra.map((x) => x.retailer.outletName)).toEqual(["Shop B"]);
    await expect(ctxRun((c) => decide(c, admin(), id, { accept: false }, NOW))).rejects.toThrow(/Already accepted/);
  });

  it("applies itself when the business turns on auto", async () => {
    const tomorrow = addDay(TODAY, 1);
    expect(await ctxRun((c) => planVisits(c, tomorrow, NOW, { ...S, visitPlan: { ...S.visitPlan, auto: true } }))).toBe(1);
    const s = await tx((t) => t.suggestion.findFirstOrThrow({ where: { kind: "visit_plan", forDate: tomorrow } }));
    expect([s.status, s.auto]).toEqual(["ACCEPTED", true]);
    expect(await tx((t) => t.visitTask.count({ where: { date: tomorrow } }))).toBeGreaterThan(0);
  });
});

describe("collections and credit", () => {
  it("suggests stopping credit for D, and only D", async () => {
    expect(await ctxRun((c) => reviewCollections(c, NOW, S))).toBe(1);
    const s = await tx((t) => t.suggestion.findFirstOrThrow({ where: { kind: "credit_stop" } }));
    expect(s.subjectId).toBe(shop.D);
    expect(s.detail).toMatch(/35 days late/);
  });

  it("reviews limits: raises E, sets one for A, skips D while its stop is open", async () => {
    expect(await ctxRun((c) => reviewCredit(c, NOW, S))).toBe(2);
    const list = await tx((t) => t.suggestion.findMany({ where: { kind: "credit_limit" } }));
    const e = list.find((x) => x.subjectId === shop.E)!;
    const a = list.find((x) => x.subjectId === shop.A)!;
    expect(e.title).toMatch(/^Raise Shop E's credit limit to ₹/);
    expect((e.payload as { to: number }).to).toBeGreaterThan(200_000);
    expect(a.title).toMatch(/^Set a credit limit of ₹1,000 for Shop A/);
    expect(list.some((x) => x.subjectId === shop.D)).toBe(false);
    expect(await ctxRun((c) => reviewCredit(c, NOW, S))).toBe(0); // once a week
  });

  it("refuses a limit change when someone changed the limit in between", async () => {
    const e = await tx((t) => t.suggestion.findFirstOrThrow({ where: { kind: "credit_limit", subjectId: shop.E } }));
    await tx((t) => t.retailerProfile.update({ where: { id: shop.E }, data: { creditLimit: 300_000 } }));
    await expect(ctxRun((c) => decide(c, admin(), e.id, { accept: true }, NOW))).rejects.toThrow(/has changed/);
    await tx((t) => t.retailerProfile.update({ where: { id: shop.E }, data: { creditLimit: 200_000 } }));
    const r = await ctxRun((c) => decide(c, admin(), e.id, { accept: true }, NOW));
    expect(r.audits[0]).toMatchObject({ action: "retailer.terms", before: { creditLimit: 200_000 } });
  });

  it("stops D's credit, then offers it back once D pays", async () => {
    const stop = await tx((t) => t.suggestion.findFirstOrThrow({ where: { kind: "credit_stop" } }));
    await ctxRun((c) => decide(c, admin(), stop.id, { accept: true, note: "Called, no answer" }, NOW));
    expect((await tx((t) => t.retailerProfile.findUniqueOrThrow({ where: { id: shop.D } }))).creditLimit).toBe(0);
    expect(await ctxRun((c) => reviewCollections(c, NOW, S))).toBe(0); // still owes
    await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: shop.D, amount: 80_000, method: "CASH", atOffice: true, occurredAt: NOW }));
    expect(await ctxRun((c) => reviewCollections(c, NOW, S))).toBe(1);
    const back = await tx((t) => t.suggestion.findFirstOrThrow({ where: { kind: "credit_restore" } }));
    await ctxRun((c) => decide(c, admin(), back.id, { accept: true }, NOW));
    expect((await tx((t) => t.retailerProfile.findUniqueOrThrow({ where: { id: shop.D } }))).creditLimit).toBeNull();
  });
});

describe("checks", () => {
  const Y = addDay(TODAY, -1);

  beforeAll(async () => {
    const db = tenantDb(T);
    await db.cashHandover.create({ data: { staffUserId: drivers[0].userId, receivedById: adminId, expected: 500_000, counted: 450_000, variance: 50_000, createdAt: ago(1, 1200) } });
    for (const d of [20, 10, 1]) {
      await db.order.create({
        data: {
          orderNumber: await nextOrderNumber(db, T, ago(d + 1)),
          retailerId: shop.C,
          status: "CANCELLED",
          totalAmount: 1000,
          createdAt: ago(d + 1),
          delivery: { create: { deliveryAgentId: drivers[1].id, state: "FAILED", failReason: "shop_closed", failedAt: ago(d, 700), attempts: 1, seq: 1 } },
        },
      });
    }
    await db.order.create({ data: { orderNumber: await nextOrderNumber(db, T, ago(1)), retailerId: shop.C, status: "PLACED", grossAmount: 10_000, discountAmount: 3_000, totalAmount: 7_000, createdAt: ago(1), deliveryDate: new Date(`${addDay(TODAY, 5)}T00:00:00Z`) } });
  });

  it("flags cash short, a far delivery, a shop closed again and again, and a big discount", async () => {
    expect(await ctxRun((c) => runChecks(c, Y, S))).toBe(4);
    const list = await tx((t) => t.suggestion.findMany({ where: { kind: "check" }, orderBy: { score: "desc" } }));
    const kinds = list.map((x) => (x.payload as { check: string }).check).sort();
    expect(kinds).toEqual(["big_discount", "cash_variance", "far_from_shop", "shop_closed"]);
    expect(list.find((x) => (x.payload as { check: string }).check === "cash_variance")!.title).toBe("Cash short at hand-over: Amit short by ₹500");
    expect(list.find((x) => (x.payload as { check: string }).check === "big_discount")!.title).toMatch(/30% off/);
    expect(await ctxRun((c) => runChecks(c, Y, S))).toBe(0);
  });

  it("can be turned off", async () => {
    expect(await ctxRun((c) => runChecks(c, Y, { ...S, checks: { ...S.checks, on: false } }))).toBe(0);
  });
});

describe("trip plan", () => {
  const D2 = addDay(TODAY, 1);

  beforeAll(async () => {
    const db = tenantDb(T);
    for (const k of ["A", "B", "C", "E"] as const) {
      await db.order.create({
        data: { orderNumber: await nextOrderNumber(db, T, NOW), retailerId: shop[k], status: "CONFIRMED", totalAmount: 50_000, deliveryDate: new Date(`${D2}T00:00:00Z`), items: { create: { productId: P.P1, quantity: 5, price: 10000, gstRate: 0 } } },
      });
    }
  });

  it("splits north and south into two trips and makes them when accepted", async () => {
    const s = await ctxRun((c) => planTrips(c, { date: D2 }, NOW, { ...S, tripPlan: { on: true, maxDrops: 2 } }));
    const trips = (s!.payload as { trips: { orderIds: string[]; areas: string[]; driverName: string }[] }).trips;
    expect(trips.map((t) => [t.driverName, t.areas, t.orderIds.length])).toEqual([
      ["Amit", trips[0].areas, 2],
      ["Bala", trips[1].areas, 2],
    ]);
    expect(trips.map((t) => t.areas.join()).sort()).toEqual(["North", "South"]);
    const r = await ctxRun((c) => decide(c, admin(), s!.id, { accept: true }, NOW));
    expect(r.status === "ACCEPTED" && (r.result as { trips: unknown[] }).trips).toHaveLength(2);
    expect(await tx((t) => t.delivery.count({ where: { trip: { date: new Date(`${D2}T00:00:00Z`) } } }))).toBe(4);
    await expect(ctxRun((c) => planTrips(c, { date: D2 }, NOW, S))).rejects.toThrow(MoneyError);
  });
});

describe("running, expiry and AI cost", () => {
  it("logs each run and expires what is out of date", async () => {
    await tx((t) => t.suggestion.create({ data: { kind: "check", subjectType: "order", subjectId: "x", title: "old", dedupeKey: `old:${rand()}`, expiresAt: new Date(Date.now() - 1000) } }));
    const r = await runFeature(T, "expire", "manual");
    expect(r.made).toBeGreaterThanOrEqual(1);
    const run = await tx((t) => t.automationRun.findFirstOrThrow({ where: { feature: "expire" }, orderBy: { startedAt: "desc" } }));
    expect([run.trigger, run.made, run.error]).toEqual(["manual", r.made, null]);
  });

  it("records AI use against the month's credits", async () => {
    await tx((t) => recordAiUse(t, T, { feature: "test", provider: "fake", model: "m", inputTokens: 100, outputTokens: 20, costPaise: 3, credits: 2 }));
    await tx((t) => recordAiUse(t, T, { feature: "test", provider: "fake", model: "m", inputTokens: 10, outputTokens: 2, costPaise: 1, credits: 1 }));
    const u = await tx((t) => t.usageCounter.findFirstOrThrow({ where: { metric: "ai_credits" } }));
    expect([u.value, u.costPaise]).toEqual([3, 4]);
    expect(await tx((t) => t.aiCostLog.count())).toBe(2);
    await expect(tx((t) => recordAiUse(t, T, { feature: "x", provider: "f", model: "m", inputTokens: -1, outputTokens: 0, costPaise: 0, credits: 0 }))).rejects.toThrow(/non-negative/);
  });

  it("keeps each business's suggestions to itself", async () => {
    const other = await asPlatform((t) => t.tenant.findFirstOrThrow({ where: { slug: "demo" }, select: { id: true } }));
    const seen = await withTenantTx(other.id, (t) => t.suggestion.count({ where: { tenantId: T } }));
    expect(seen).toBe(0);
  });
});
