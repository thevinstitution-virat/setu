/**
 * Phase 10 analytics. Pure rules (periods, churn, settings, channels), then a
 * scratch business with a known month of trading posted through the real
 * ledger engine, so every figure can be checked exactly (and nothing from the
 * demo business leaks in). The scratch business is purged at the end.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { createTenantRecord } from "@/lib/signup";
import { purgeTenant } from "@/lib/tenant-data";
import { bookSale, issueCreditNote, onOrderDelivered, recordPayment, withMoney } from "@/lib/ledger";
import { nextOrderNumber } from "@/lib/orders";
import { addDay, istDayRange } from "@/lib/field-math";
import { can } from "@/lib/permissions";
import { channelAllowed } from "@/lib/notify-events";
import { parseReportSettings, reportSettings } from "@/lib/report-settings";
import { istHour, sendDailySummary } from "@/lib/daily-summary";
import {
  change,
  churnRisk,
  collections,
  deliveryPerformance,
  makePeriod,
  orderTotals,
  outstanding,
  presetPeriod,
  previousPeriod,
  productMix,
  retailerAnalytics,
  returnsAndDamage,
  routeProfitability,
  salesByDay,
  salesTotals,
  schemeRoi,
  stockValue,
  agentPerformance,
} from "@/lib/analytics";
import { csvRows, REPORT_KINDS } from "@/lib/analytics-csv";
import { loadReport } from "@/lib/reports";

const rand = () => Math.random().toString(36).slice(2, 8);
const at = (day: string, min: number) => new Date(istDayRange(day).from.getTime() + min * 60_000);

// ───────────────────────────── pure rules ─────────────────────────────

describe("periods", () => {
  it("makes IST periods and the one before", () => {
    const p = makePeriod("2026-10-01", "2026-10-31");
    expect(p.days).toBe(31);
    expect(p.start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(p.end.toISOString()).toBe("2026-10-31T18:30:00.000Z");
    const prev = previousPeriod(p);
    expect([prev.from, prev.to]).toEqual(["2026-08-31", "2026-09-30"]);
  });

  it("refuses bad or too long periods", () => {
    expect(() => makePeriod("2026-10-05", "2026-10-01")).toThrow("Pick the dates");
    expect(() => makePeriod("2025-01-01", "2026-03-01")).toThrow("at most a year");
    expect(() => makePeriod("nope", "2026-10-01")).toThrow();
  });

  it("works out presets in IST", () => {
    const now = new Date("2026-11-19T20:00:00Z"); // 01:30 IST on the 20th
    expect(presetPeriod("today", now).from).toBe("2026-11-20");
    expect(presetPeriod("mtd", now)).toMatchObject({ from: "2026-11-01", to: "2026-11-20" });
    expect(presetPeriod("last_month", now)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetPeriod("7d", now)).toMatchObject({ from: "2026-11-14", days: 7 });
    expect(presetPeriod("fy", now).from).toBe("2026-04-01");
    expect(presetPeriod("fy", new Date("2027-02-10T06:00:00Z")).from).toBe("2026-04-01");
  });

  it("gives % change only when there is something to compare with", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(50, 100)).toBe(-50);
    expect(change(10, 0)).toBeNull();
    expect(change(1, 3)).toBe(-66.7);
  });
});

describe("churn risk", () => {
  it("compares days since the last order with the shop's own rhythm", () => {
    expect(churnRisk(0, null, null)).toBe("none");
    expect(churnRisk(1, null, 10)).toBe("new");
    expect(churnRisk(1, null, 45)).toBe("high");
    expect(churnRisk(10, 5, 4)).toBe("low");
    expect(churnRisk(10, 5, 10)).toBe("medium"); // 2× gap, over 7 days
    expect(churnRisk(10, 5, 16)).toBe("high"); // 3.2× gap, over 14 days
    expect(churnRisk(10, 2, 7)).toBe("low"); // gap floored at 3: 7 ≥ 5.4, but slipping also needs over 7 days
  });

  it("does not flag a short silence as high", () => {
    expect(churnRisk(20, 1, 6)).toBe("low"); // 6 ≥ 3×3 is false
    expect(churnRisk(20, 1, 8)).toBe("medium");
    expect(churnRisk(20, 1, 12)).toBe("medium"); // 3× floor 3 = 9, but not over 14 days
    expect(churnRisk(20, 1, 15)).toBe("high");
  });
});

describe("report settings and channels", () => {
  it("defaults to a 9 pm summary and no delivery cost", () => {
    expect(reportSettings({})).toEqual({ dailySummary: true, summaryHour: 21, tripCost: 0, dropCost: 0 });
    expect(reportSettings({ reports: { summaryHour: 99, tripCost: -5 } })).toMatchObject({ summaryHour: 21, tripCost: 0 });
  });

  it("checks what an owner saves", () => {
    expect(parseReportSettings({ summaryHour: 20, dailySummary: false, tripCost: 150000 })).toEqual({ summaryHour: 20, dailySummary: false, tripCost: 150000 });
    expect(parseReportSettings({ summaryHour: 24 })).toBe("Pick the hour for the daily summary");
    expect(parseReportSettings({ dropCost: 1.5 })).toMatch(/Cost per drop/);
    expect(parseReportSettings({ tripCost: 20_000_000 })).toMatch(/Cost per trip/);
  });

  it("lets only the owner's summary go to staff on WhatsApp", () => {
    expect(channelAllowed("staff.daily_summary", "whatsapp")).toBe(true);
    expect(channelAllowed("staff.daily_summary", "sms")).toBe(false);
    expect(channelAllowed("staff.order", "whatsapp")).toBe(false);
    expect(channelAllowed("staff.order", "push")).toBe(true);
    expect(channelAllowed("order.placed", "sms")).toBe(true);
  });

  it("gives reports to admins only", () => {
    expect(can("ADMIN", "reports.view")).toBe(true);
    for (const r of ["SUPERVISOR", "SALES_AGENT", "DELIVERY_AGENT", "RETAILER"] as const) expect(can(r, "reports.view")).toBe(false);
  });

  it("reads the IST hour", () => {
    expect(istHour(new Date("2026-11-19T15:30:00Z"))).toBe(21);
    expect(istHour(new Date("2026-11-19T18:29:00Z"))).toBe(23);
  });
});

// ───────────────────────────── a known month ─────────────────────────────

/*
 * Scratch business, October 2026 (IST). One product: price ₹100, last cost ₹60, no GST.
 *   Asha (A): orders on the 2nd, 7th, 12th … 27th (6 orders × 10 units = ₹1,000 each),
 *     delivered next day on trips; paid at the door by UPI except the 27th.
 *     The 12th order used a scheme (₹30). One unit of the 2nd order came back (credit note ₹100).
 *   Bharat (B): ordered on 1–3 September and the 1st October only (every 5 days before), so by
 *     31 October it has been 30 days: at risk.
 *   Chetan (C): no orders.
 *   Deepa (D): ordered in September (₹500) and October (₹800): the scheme control shop.
 * Plus one cancelled order (not counted) and one failed delivery.
 */
let T = "";
let adminId = "";
let agentUserId = "";
let agentId = "";
let driverUserId = "";
let driverId = "";
let productId = "";
let schemeId = "";
const shop: Record<"A" | "B" | "C" | "D", string> = { A: "", B: "", C: "", D: "" };
const OCT = makePeriod("2026-10-01", "2026-10-31");
const NOW = new Date("2026-10-31T12:00:00Z"); // 17:30 IST, 31 Oct
let tripId = "";

async function sell(o: { shop: string; day: string; qty: number; paid?: boolean; deliverDay?: string; trip?: boolean; failed?: boolean; cancelled?: boolean; scheme?: number }) {
  const db = tenantDb(T);
  const total = o.qty * 10000;
  const deliveredAt = at(o.deliverDay ?? addDay(o.day, 1), 660);
  const order = await db.order.create({
    data: {
      orderNumber: await nextOrderNumber(db, T, at(o.day, 600)),
      retailerId: o.shop,
      placedById: agentUserId,
      status: o.cancelled || o.failed ? "CANCELLED" : "DELIVERED",
      subtotal: total,
      gstAmount: 0,
      totalAmount: total,
      grossAmount: total,
      deliveryDate: new Date(`${addDay(o.day, 1)}T00:00:00Z`),
      createdAt: at(o.day, 600),
      items: { create: { productId, quantity: o.qty, price: 10000, gstRate: 0 } },
      ...(o.cancelled
        ? {}
        : {
            delivery: {
              create: {
                deliveryAgentId: driverId,
                tripId: o.trip ? tripId : null,
                paymentMethod: "CASH",
                paymentStatus: "PENDING",
                codAmount: total,
                seq: 1,
                ...(o.failed ? { state: "FAILED" as const, failReason: "shop_closed", failedAt: deliveredAt, attempts: 2 } : { state: "DELIVERED" as const, deliveredAt }),
              },
            },
          }),
    },
  });
  if (o.scheme) await db.schemeRedemption.create({ data: { schemeId, orderId: order.id, retailerId: o.shop, value: o.scheme, createdAt: at(o.day, 600) } });
  if (o.cancelled || o.failed) return order;
  await withMoney(T, driverUserId, async (ctx) => {
    await bookSale(ctx, order.id, deliveredAt);
    await onOrderDelivered(ctx, order, o.paid ? { amount: total, method: "UPI", reference: null, collectorId: driverUserId, occurredAt: deliveredAt } : null);
  });
  return order;
}

beforeAll(async () => {
  const { tenant, user } = await asPlatform((tx) =>
    createTenantRecord(tx, { slug: `p10${rand()}`, name: `Phase 10 test ${rand()}`, stateCode: "27" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: "9811100000" })
  );
  T = tenant.id;
  adminId = user.id;
  const db = tenantDb(T);
  const region = await db.region.create({ data: { name: "Pune", areas: { create: [{ name: "Kothrud" }, { name: "Baner" }] } }, include: { areas: true } });
  const [kothrud, baner] = region.areas;
  const cat = await db.category.create({ data: { name: "Staples" } });
  productId = (await db.product.create({ data: { name: "Rice 1kg", sku: "R1", categoryId: cat.id, unit: "pack", price: 10000, mrp: 12000, gstRate: 0, lastCost: 6000 } })).id;
  const agent = await db.user.create({ data: { name: "Agent", loginId: "agent", passwordHash: "x", role: "SALES_AGENT", salesAgentProfile: { create: {} } }, include: { salesAgentProfile: true } });
  agentUserId = agent.id;
  agentId = agent.salesAgentProfile!.id;
  const driver = await db.user.create({ data: { name: "Driver", loginId: "driver", passwordHash: "x", role: "DELIVERY_AGENT", deliveryAgentProfile: { create: {} } }, include: { deliveryAgentProfile: true } });
  driverUserId = driver.id;
  driverId = driver.deliveryAgentProfile!.id;
  for (const [k, area, i] of [["A", kothrud, 1], ["B", kothrud, 2], ["C", baner, 3], ["D", baner, 4]] as const) {
    const u = await db.user.create({
      data: { name: `Shop ${k}`, phone: `90000${rand().replace(/\D/g, "").padEnd(5, "0").slice(0, 5)}`, role: "RETAILER", retailerProfile: { create: { outletName: `Shop ${k}`, shopNumber: String(i), complexName: "M", pinCode: "411038", areaId: area.id, salesAgentId: agentId, creditDays: 7 } } },
      include: { retailerProfile: true },
    });
    shop[k] = u.retailerProfile!.id;
  }
  schemeId = (await db.scheme.create({ data: { name: "Rice 3% off", type: "PERCENT", params: { percent: 3 } } })).id;
  tripId = (await db.trip.create({ data: { number: "TRP-T-1", date: new Date("2026-10-08T00:00:00Z"), slot: "morning", driverId, status: "CLOSED" } })).id;

  // August: D once (so records start before September, the period before October).
  await sell({ shop: shop.D, day: "2026-08-10", qty: 1, paid: true });
  // September: B every 5 days, D once.
  for (const day of ["2026-09-16", "2026-09-21", "2026-09-26"]) await sell({ shop: shop.B, day, qty: 4, paid: true });
  await sell({ shop: shop.D, day: "2026-09-20", qty: 5, paid: true });
  // October.
  await sell({ shop: shop.B, day: "2026-10-01", qty: 4, paid: true });
  const first = await sell({ shop: shop.A, day: "2026-10-02", qty: 10, paid: true, trip: true, deliverDay: "2026-10-03" });
  await sell({ shop: shop.A, day: "2026-10-07", qty: 10, paid: true, trip: true, deliverDay: "2026-10-09" }); // a day late
  await sell({ shop: shop.A, day: "2026-10-12", qty: 10, paid: true, scheme: 3000 });
  await sell({ shop: shop.A, day: "2026-10-17", qty: 10, paid: true });
  await sell({ shop: shop.A, day: "2026-10-22", qty: 10, paid: true });
  await sell({ shop: shop.A, day: "2026-10-27", qty: 10, paid: false });
  await sell({ shop: shop.D, day: "2026-10-20", qty: 8, paid: false });
  await sell({ shop: shop.C, day: "2026-10-10", qty: 3, cancelled: true });
  await sell({ shop: shop.D, day: "2026-10-25", qty: 2, failed: true });
  // One unit back from Asha's first order.
  await withMoney(T, adminId, async (ctx) => {
    const inv = await ctx.tx.invoice.findFirstOrThrow({ where: { orderId: first.id }, include: { lines: true } });
    await issueCreditNote(ctx, { invoiceId: inv.id, kind: "return", reason: "Torn pack", lines: [{ lineId: inv.lines[0].id, quantity: 1 }] }, at("2026-10-05", 700));
  });
  // D pays half of its October bill at the office.
  await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: shop.D, amount: 40000, method: "CASH", atOffice: true, occurredAt: at("2026-10-28", 700) }));
}, 60_000);

afterAll(async () => {
  if (T) await purgeTenant(T).catch(() => null);
  await prisma.$disconnect();
});

const tx = <R>(fn: (t: Parameters<Parameters<typeof withTenantTx>[1]>[0]) => Promise<R>) => withTenantTx(T, fn, { timeout: 30_000 });

describe("sales and orders", () => {
  it("counts invoices less credit notes, in the period only", async () => {
    const s = await tx((t) => salesTotals(t, OCT));
    // Oct invoices: B 400 + A 6×1000 + D 800 = 7,200; credit note 100.
    expect(s.gross).toBe(720000);
    expect(s.credits).toBe(10000);
    expect(s.net).toBe(710000);
    expect(s.netTaxable).toBe(710000);
    expect(s.invoices).toBe(8);
  });

  it("counts booked orders without the cancelled ones", async () => {
    const o = await tx((t) => orderTotals(t, OCT));
    expect(o.cancelled).toBe(2); // the cancelled one and the failed delivery
    expect(o.count).toBe(8);
    expect(o.value).toBe(720000);
    expect(o.avg).toBe(90000);
  });

  it("spreads sales over IST days", async () => {
    const days = await tx((t) => salesByDay(t, OCT));
    expect(days).toHaveLength(31);
    expect(days.find((d) => d.day === "2026-10-03")!.net).toBe(100000);
    expect(days.find((d) => d.day === "2026-10-05")!.net).toBe(-10000);
    expect(days.reduce((a, d) => a + d.net, 0)).toBe(710000);
  });

  it("nets products and categories", async () => {
    const m = await tx((t) => productMix(t, OCT));
    expect(m.products).toEqual([expect.objectContaining({ name: "Rice 1kg", qty: 71, taxable: 710000, share: 100 })]);
    expect(m.categories).toEqual([{ name: "Staples", taxable: 710000, share: 100 }]);
  });
});

describe("money", () => {
  it("sums money received by method, without wallet or credit notes", async () => {
    const c = await tx((t) => collections(t, OCT));
    // UPI at the door: B 400 + A 5×1000 = 5,400; cash at the office 400.
    expect(c.byMethod.find((m) => m.method === "UPI")!.amount).toBe(540000);
    expect(c.byMethod.find((m) => m.method === "CASH")!.amount).toBe(40000);
    expect(c.received).toBe(580000);
  });

  it("ages what is still open", async () => {
    const o = await tx((t) => outstanding(t, NOW));
    // A: ₹1,000 (27th, minus nothing) less the ₹100 credit note applied to its oldest bill → 900 left in total;
    // D: ₹800 − ₹400 = ₹400.
    expect(o.total).toBe(130000);
    expect(o.shops).toBe(2);
    const d = o.debtors.find((x) => x.retailerId === shop.D)!;
    expect(d.outstanding).toBe(40000);
    expect(d.overdue).toBe(40000); // due 21 + 7 = 28 Oct
    expect(o.ageing.reduce((a, b) => a + b.amount, 0)).toBe(o.total);
  });
});

describe("delivery and team", () => {
  it("measures on time, first attempt and failures", async () => {
    const d = await tx((t) => deliveryPerformance(t, OCT));
    expect(d.delivered).toBe(8);
    expect(d.failed).toBe(1);
    expect(d.onTime).toBe(7); // the 7th order came a day late
    expect(d.successRate).toBe(88.9);
    expect(d.failReasons).toEqual([{ key: "shop_closed", label: "Shop closed", count: 1 }]);
    expect(d.trips).toBe(1);
  });

  it("ranks the sales agent and the driver", async () => {
    const a = await tx((t) => agentPerformance(t, OCT));
    expect(a.sales.find((s) => s.userId === agentUserId)).toMatchObject({ orders: 8, value: 720000, visits: 0, strikeRate: null });
    expect(a.drivers.find((s) => s.userId === driverUserId)).toMatchObject({ delivered: 8, failed: 1, trips: 1 });
  });
});

describe("shops", () => {
  it("finds the regular, the at-risk and the silent shop", async () => {
    const r = await tx((t) => retailerAnalytics(t, OCT));
    const of = (id: string) => r.rows.find((x) => x.retailerId === id)!;
    expect(of(shop.A)).toMatchObject({ orders: 6, value: 600000, avgOrder: 100000, usualGap: 5, daysSince: 4, risk: "low" });
    expect(of(shop.B)).toMatchObject({ orders: 1, daysSince: 30, risk: "high", prevValue: 120000 });
    expect(of(shop.C)).toMatchObject({ orders: 0, risk: "none", lastOrder: null });
    expect(r.risk.high).toBe(1);
    expect(r.ordering).toBe(3);
  });

  it("filters by area", async () => {
    const r = await tx(async (t) => retailerAnalytics(t, OCT, { areaId: (await t.retailerProfile.findUniqueOrThrow({ where: { id: shop.C } })).areaId }));
    expect(r.rows.map((x) => x.outletName).sort()).toEqual(["Shop C", "Shop D"]);
  });
});

describe("schemes, routes and returns", () => {
  it("works out scheme ROI against the shops without a scheme", async () => {
    const s = await tx((t) => schemeRoi(t, OCT));
    const r = s.schemes[0];
    expect(r).toMatchObject({ name: "Rice 3% off", cost: 3000, orders: 1, shops: 1, sales: 100000, before: 0, after: 600000 });
    // A bought nothing in September, so there is no "before" to grow from: no extra / ROI.
    expect(r.extra).toBeNull();
    expect(r.roi).toBeNull();
    // Control: B and D went from 1,700 to 1,200 (−29.4%).
    expect(s.controlGrowth).toBe(-29.4);
    expect(s.fullHistory).toBe(true);
  });

  it("refuses a before-and-after when records start inside the period before", async () => {
    const s = await tx((t) => schemeRoi(t, makePeriod("2026-09-01", "2026-09-30")));
    expect(s.fullHistory).toBe(false);
    expect(s.controlGrowth).toBeNull();
  });

  it("works out margin and delivery cost by area and trip", async () => {
    const r = await tx((t) => routeProfitability(t, OCT, { tripCost: 50000, dropCost: 1000 }));
    const k = r.areas.find((a) => a.name === "Kothrud")!;
    // Kothrud: A 6,000 − 100 credit + B 400 = 6,300 sales; cost 60 × (60 − 1 + 4) units = 3,780.
    expect(k.revenue).toBe(630000);
    expect(k.cogs).toBe(378000);
    expect(k.margin).toBe(252000);
    expect(k.drops).toBe(7);
    // 7 drops × ₹10, plus one trip of ₹500 shared by its 2 drops (both Kothrud).
    expect(k.deliveryCost).toBe(7 * 1000 + 50000);
    expect(r.trips).toEqual([expect.objectContaining({ number: "TRP-T-1", drops: 2, revenue: 190000, deliveryCost: 52000 })]);
    expect(r.totals.uncosted).toBe(0);
  });

  it("reports returns, credit notes and shorts", async () => {
    const r = await tx((t) => returnsAndDamage(t, OCT));
    expect(r.credits).toBe(10000);
    expect(r.returnRate).toBe(1.4);
    expect(r.noteKinds).toEqual([{ key: "return", label: "Goods returned", count: 1, value: 10000 }]);
    expect(r.reasons[0]).toMatchObject({ reason: "Torn pack", value: 10000 });
    expect(r.products[0]).toMatchObject({ name: "Rice 1kg", sold: 72, returned: 1 });
    expect(r.shops[0]).toMatchObject({ retailerId: shop.A, credited: 10000 });
  });

  it("values stock (none here) without failing", async () => {
    const s = await tx((t) => stockValue(t, NOW));
    expect(s).toMatchObject({ total: 0, uncostedLots: 0, top: [] });
  });
});

describe("loading reports", () => {
  it("loads every report and turns it into CSV rows", async () => {
    for (const k of REPORT_KINDS) {
      const d = await loadReport(T, k, OCT, {}, NOW);
      const rows = csvRows(k, d as never);
      expect(rows.length, k).toBeGreaterThan(1);
    }
  });

  it("keeps each business's figures to itself", async () => {
    const d = await loadReport(T, "dashboard", OCT, {}, NOW);
    expect(d.sales.net).toBe(710000);
    expect(d.team.sales.every((s) => [agentUserId].includes(s.userId))).toBe(true);
  });
});

describe("daily summary", () => {
  it("sends once a day at the business's hour, to the owners", async () => {
    const nine = new Date("2026-10-31T15:30:00Z"); // 21:00 IST
    expect(await sendDailySummary(T, new Date("2026-10-31T12:00:00Z"))).toBe("not_due");
    expect(await sendDailySummary(T, nine)).toBe("sent");
    expect(await sendDailySummary(T, new Date(nine.getTime() + 60_000))).toBe("sent"); // retried: same key
    const notes = await tenantDb(T).notification.findMany({ where: { event: "staff.daily_summary" } });
    expect(notes).toHaveLength(1);
    expect(notes[0].userId).toBe(adminId);
    expect(notes[0].body).toContain("Delivered 0");
    expect(notes[0].body).toContain("New orders: 0, worth ₹0");
  });

  it("goes on WhatsApp only when the business turned it on", async () => {
    const db = tenantDb(T);
    expect(await db.messageLog.count({ where: { event: "staff.daily_summary", channel: "WHATSAPP" } })).toBe(0);
    const t = await asPlatform((x) => x.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } }));
    await asPlatform((x) => x.tenant.update({ where: { id: T }, data: { settings: { ...(t.settings as object), notify: { channels: { push: true, whatsapp: true, sms: true } } } } }));
    expect(await sendDailySummary(T, new Date("2026-11-01T15:30:00Z"))).toBe("sent");
    const logs = await db.messageLog.findMany({ where: { event: "staff.daily_summary" } });
    expect(logs.map((l) => l.channel)).toEqual(["WHATSAPP"]); // no SMS for staff, no push without a device
    expect(logs[0].to).toBe("9811100000");
  });

  it("can be turned off, and sent by hand", async () => {
    const t = await asPlatform((x) => x.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } }));
    await asPlatform((x) => x.tenant.update({ where: { id: T }, data: { settings: { ...(t.settings as object), reports: { dailySummary: false } } } }));
    expect(await sendDailySummary(T, new Date("2026-11-02T15:30:00Z"))).toBe("off");
    expect(await sendDailySummary(T, new Date("2026-11-02T15:30:00Z"), { force: true })).toBe("sent");
  });
});
