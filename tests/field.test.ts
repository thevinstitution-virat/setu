/**
 * Phase 6 against the real database: attendance with selfie and position,
 * positions only on duty, leave and who may approve it, beats and dated
 * plans, visits with an outcome, off-beat rules, shops added from the field,
 * targets and incentives, the supervisor's scope and team day, CSV reports
 * and the single-use business switch.
 *
 * Fresh users in the demo tenant, on fixed past days; settings restored afterwards.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx } from "@/lib/db";
import { withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { FIELD_DEFAULTS, parseFieldSettings } from "@/lib/field-settings";
import {
  achievements,
  beatForDay,
  checkIn,
  checkOut,
  decideLead,
  decideLeave,
  endVisit,
  leaderboard,
  onLeave,
  proposeLead,
  purgePings,
  recordPings,
  reportRows,
  requestLeave,
  saveBeat,
  saveTarget,
  setBeatPlans,
  startVisit,
  targetProgress,
  teamDay,
  teamScope,
  toCsv,
  type Who,
} from "@/lib/field";
import {
  addDay,
  daysInclusive,
  isLate,
  istDay,
  istDayRange,
  longestGapMinutes,
  metres,
  pathMetres,
  payout,
  validFssai,
  validMobile,
  weekday,
} from "@/lib/field-math";
import { consumeHandoff, HandoffError, signHandoff } from "@/lib/handoff";

const run = Date.now().toString().slice(-6);
const phone = (n: number) => `7${run}${String(n).padStart(3, "0")}`;
let T = "";
let T2 = "";
let original: unknown = null;
let adminId = "";
let areaId = "";
let productId = "";
const u = { sup: "", agent: "", driver: "", other: "", otherSup: "" };
let agentProfile = "";
let otherProfile = "";
const shops = { a: "", b: "", c: "", foreign: "" };
let secondUserId = "";

// A fixed Monday well in the past, so nothing clashes with today's real data.
const DAY = "2026-03-02";
const at = (day: string, hh: number, mm = 0) => new Date(istDayRange(day).from.getTime() + (hh * 60 + mm) * 60_000);
const as = <X>(who: string, fn: Parameters<typeof withMoney<X>>[2]) => withMoney(T, who, fn);
const W = (userId: string, role: Who["role"]): Who => ({ userId, role });
const proof = { selfie: "t/selfie/x.jpg", lat: 19.07, lng: 72.88, accuracy: 10 };

async function setField(patch: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  const s = (t.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...s, field: { ...FIELD_DEFAULTS, ...patch } } as object } });
}

async function mkUser(name: string, role: "SALES_AGENT" | "DELIVERY_AGENT" | "SUPERVISOR", n: number, supervisorId: string | null = null) {
  return tenantDb(T).user.create({
    data: {
      name: `${name} ${run}`,
      phone: phone(n),
      role,
      supervisorId,
      ...(role === "SALES_AGENT" ? { salesAgentProfile: { create: {} } } : {}),
      ...(role === "DELIVERY_AGENT" ? { deliveryAgentProfile: { create: {} } } : {}),
    },
    include: { salesAgentProfile: true },
  });
}

async function mkShop(n: number, salesAgentId: string | null, lat = 19.1, lng = 72.85) {
  const r = await tenantDb(T).user.create({
    data: {
      name: `Field shop ${run}-${n}`,
      phone: phone(100 + n),
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Field shop ${run}-${n}`, shopNumber: "1", complexName: "Test", pinCode: "400001", areaId, salesAgentId, lat, lng, paymentMode: "POSTPAID", creditLimit: null } },
    },
    include: { retailerProfile: true },
  });
  return r.retailerProfile!.id;
}

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  T2 = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "second" }, select: { id: true } })).id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  productId = (await db.product.findFirstOrThrow({ where: { active: true, sku: "BEV-001" } })).id;
  u.sup = (await mkUser("Sup", "SUPERVISOR", 1)).id;
  u.otherSup = (await mkUser("Other sup", "SUPERVISOR", 2)).id;
  const a = await mkUser("Agent", "SALES_AGENT", 3, u.sup);
  u.agent = a.id;
  agentProfile = a.salesAgentProfile!.id;
  u.driver = (await mkUser("Driver", "DELIVERY_AGENT", 4, u.sup)).id;
  const o = await mkUser("Outsider", "SALES_AGENT", 5, u.otherSup);
  u.other = o.id;
  otherProfile = o.salesAgentProfile!.id;
  shops.a = await mkShop(1, agentProfile, 19.1, 72.85);
  shops.b = await mkShop(2, agentProfile, 19.105, 72.85);
  shops.c = await mkShop(3, agentProfile, 19.11, 72.85);
  shops.foreign = await mkShop(4, otherProfile, 19.2, 72.9);
  secondUserId = (await tenantDb(T2).user.create({ data: { name: `Agent ${run}`, phone: phone(3), role: "SALES_AGENT", salesAgentProfile: { create: {} } } })).id;
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: T },
    data: { settings: { ...(t.settings as object), cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, freeDeliveryAbove: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" } } as object },
  });
  await setField({ trackLocation: true });
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).user.updateMany({ where: { id: { in: Object.values(u) } }, data: { active: false } });
    await tenantDb(T2).user.updateMany({ where: { id: secondUserId }, data: { active: false } });
  }
});

describe("field maths", () => {
  it("IST days and weekdays", () => {
    expect(istDay(new Date("2026-03-01T18:29:00Z"))).toBe("2026-03-01");
    expect(istDay(new Date("2026-03-01T18:31:00Z"))).toBe("2026-03-02");
    expect(istDayRange("2026-03-02").from.toISOString()).toBe("2026-03-01T18:30:00.000Z");
    expect(weekday(DAY)).toBe(1);
    expect(addDay("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysInclusive("2026-03-02", "2026-03-04")).toBe(3);
    expect(isLate(at(DAY, 9, 31), "09:30")).toBe(true);
    expect(isLate(at(DAY, 9, 30), "09:30")).toBe(false);
  });

  it("distance ignores standing-still jitter, bad fixes and impossible jumps", () => {
    const t = (min: number) => new Date(Date.UTC(2026, 2, 2, 4, min));
    const still = Array.from({ length: 12 }, (_, i) => ({ at: t(i * 5), lat: 19.1 + (i % 2) * 0.00005, lng: 72.85, accuracy: 15 }));
    expect(pathMetres(still)).toBe(0);
    const line = Array.from({ length: 11 }, (_, i) => ({ at: t(i * 5), lat: 19.1 + i * 0.0009, lng: 72.85, accuracy: 10 }));
    expect(pathMetres(line)).toBeGreaterThan(990);
    expect(pathMetres(line)).toBeLessThan(1010);
    const jump = [...line.slice(0, 5), { at: t(22), lat: 20.5, lng: 73.5, accuracy: 10 }, ...line.slice(5)];
    expect(pathMetres(jump)).toBe(pathMetres(line));
    const blurry = [...line.slice(0, 5), { at: t(22), lat: 19.2, lng: 72.85, accuracy: 500 }, ...line.slice(5)];
    expect(pathMetres(blurry)).toBe(pathMetres(line));
    expect(Math.round(metres({ lat: 19, lng: 72 }, { lat: 19.009, lng: 72 }))).toBe(1001);
  });

  it("longest gap between positions", () => {
    const from = new Date("2026-03-02T04:00:00Z");
    const to = new Date("2026-03-02T06:00:00Z");
    expect(longestGapMinutes([], from, to)).toBe(120);
    expect(longestGapMinutes([{ at: new Date("2026-03-02T04:30:00Z") }, { at: new Date("2026-03-02T05:50:00Z") }], from, to)).toBe(80);
  });

  it("incentive: nothing below the floor, pro rata, capped", () => {
    const t = { goal: 1000, incentive: 10_000, minPct: 80, capPct: 120 };
    expect(payout(t, 790)).toBe(0);
    expect(payout(t, 800)).toBe(8000);
    expect(payout(t, 1000)).toBe(10_000);
    expect(payout(t, 5000)).toBe(12_000);
    expect(payout({ ...t, incentive: 0 }, 5000)).toBe(0);
  });

  it("FSSAI, mobile and settings checks", () => {
    expect(validFssai("11521999000123")).toBe(true);
    expect(validFssai("1152199900012")).toBe(false);
    expect(validMobile("9000000001")).toBe(true);
    expect(validMobile("5000000001")).toBe(false);
    expect(parseFieldSettings({ pingMinutes: 0 })).toMatch(/1 to 60/);
    expect(parseFieldSettings({ workStart: "9:30" })).toMatch(/time/);
    expect(parseFieldSettings({ selfie: false, visitRadiusM: 300 })).toEqual({ selfie: false, visitRadiusM: 300 });
  });

  it("CSV quotes cells and defuses formulas", () => {
    const csv = toCsv([["a", "b,c"], ['say "hi"', "=SUM(A1)"], [-5, null]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('a,"b,c"\r\n');
    expect(csv).toContain(`"say ""hi""",'=SUM(A1)`);
    expect(csv).toContain("-5,\r\n");
  });
});

describe("scope", () => {
  it("admins see all, supervisors their team, others themselves", async () => {
    await withTenantTx(T, async (tx) => {
      expect(await teamScope(tx, W(adminId, "ADMIN"))).toBeNull();
      const s = await teamScope(tx, W(u.sup, "SUPERVISOR"));
      expect(s).toEqual(expect.arrayContaining([u.sup, u.agent, u.driver]));
      expect(s).not.toContain(u.other);
      expect(await teamScope(tx, W(u.agent, "SALES_AGENT"))).toEqual([u.agent]);
    });
  });
});

describe("attendance and positions", () => {
  it("needs a selfie and position, is late after the start time, and only once a day", async () => {
    await expect(as(u.agent, (ctx) => checkIn(ctx, u.agent, { lat: 19, lng: 72, now: at(DAY, 9, 40) }))).rejects.toThrow(/selfie/);
    await expect(as(u.agent, (ctx) => checkIn(ctx, u.agent, { selfie: "k", now: at(DAY, 9, 40) }))).rejects.toThrow(/location/);
    const day = await as(u.agent, (ctx) => checkIn(ctx, u.agent, { ...proof, now: at(DAY, 9, 40) }));
    expect(day.late).toBe(true);
    const again = await as(u.agent, (ctx) => checkIn(ctx, u.agent, { ...proof, now: at(DAY, 10) }));
    expect(again.id).toBe(day.id);
    expect(again.checkInAt?.toISOString()).toBe(at(DAY, 9, 40).toISOString());
  });

  it("keeps positions only on duty and only when tracking is on", async () => {
    const p = (h: number, m: number, lat: number) => ({ at: at(DAY, h, m), lat, lng: 72.85, accuracy: 10, battery: 80 });
    await expect(as(u.driver, (ctx) => recordPings(ctx, u.driver, [p(10, 0, 19.1)], "app", at(DAY, 10, 1)))).rejects.toThrow(/on duty/);
    // A driver checked in for the day but with the duty switch off is off duty: no positions.
    await as(u.driver, (ctx) => checkIn(ctx, u.driver, { now: at("2026-02-27", 9) }, { auto: true }));
    await expect(as(u.driver, (ctx) => recordPings(ctx, u.driver, [p(10, 0, 19.1)], "app", at("2026-02-27", 10, 1)))).rejects.toThrow(/on duty/);
    const res = await as(u.agent, (ctx) =>
      recordPings(ctx, u.agent, [p(9, 0, 19.1), ...Array.from({ length: 10 }, (_, i) => p(10, i * 5, 19.1 + i * 0.0009))], "app", at(DAY, 11))
    );
    expect(res).toMatchObject({ saved: 10, skipped: 1, nextInSeconds: 300 });
    await setField({ trackLocation: false });
    await expect(as(u.agent, (ctx) => recordPings(ctx, u.agent, [p(10, 55, 19.11)], "app", at(DAY, 11)))).rejects.toThrow(/tracking is off/);
    await setField({ trackLocation: true });
  });

  it("check-out waits for an open visit, then freezes hours and distance", async () => {
    const v = await as(u.agent, (ctx) => startVisit(ctx, W(u.agent, "SALES_AGENT"), shops.a, { lat: 19.1, lng: 72.85 }, at(DAY, 12)));
    await expect(as(u.agent, (ctx) => checkOut(ctx, u.agent, { ...proof, now: at(DAY, 12, 30) }))).rejects.toThrow(/Check out of/);
    await as(u.agent, (ctx) => endVisit(ctx, W(u.agent, "SALES_AGENT"), v.id, { reason: "stock_enough" }, at(DAY, 12, 20)));
    const day = await as(u.agent, (ctx) => checkOut(ctx, u.agent, { ...proof, now: at(DAY, 18) }));
    expect(day.minutes).toBe(8 * 60 + 20);
    expect(day.distanceM).toBeGreaterThan(700);
    await expect(as(u.agent, (ctx) => checkIn(ctx, u.agent, { ...proof, now: at(DAY, 19) }))).rejects.toThrow(/already checked out/);
    await expect(as(u.agent, (ctx) => recordPings(ctx, u.agent, [{ at: at(DAY, 18, 30), lat: 19, lng: 72, accuracy: 5, battery: null }], "app", at(DAY, 18, 31)))).rejects.toThrow(/on duty/);
  });

  it("purges positions older than the retention period", async () => {
    await setField({ trackLocation: true, pingRetentionDays: 7 });
    const before = await tenantDb(T).locationPing.count({ where: { userId: u.agent } });
    expect(before).toBeGreaterThan(0);
    // "Now" = mid March 2026: only this file's early-March positions are older than 7 days.
    await as(adminId, (ctx) => purgePings(ctx, at("2026-03-20", 12)));
    expect(await tenantDb(T).locationPing.count({ where: { userId: u.agent } })).toBe(0);
    await setField({ trackLocation: true });
  });
});

describe("leave", () => {
  let id = "";
  it("asks, refuses overlaps, and only the supervisor (not oneself or another team) decides", async () => {
    const now = at("2026-03-05", 10);
    const l = await as(u.driver, (ctx) => requestLeave(ctx, u.driver, { fromDate: "2026-03-09", toDate: "2026-03-10", type: "sick", reason: "Fever" }, now));
    id = l.id;
    expect(l.days).toBe(2);
    await expect(as(u.driver, (ctx) => requestLeave(ctx, u.driver, { fromDate: "2026-03-10", toDate: "2026-03-11", type: "casual" }, now))).rejects.toThrow(/already asked/);
    await expect(as(u.driver, (ctx) => requestLeave(ctx, u.driver, { fromDate: "2026-03-12", toDate: "2026-03-11", type: "casual" }, now))).rejects.toThrow(/before/);
    await expect(as(u.otherSup, (ctx) => decideLeave(ctx, W(u.otherSup, "SUPERVISOR"), id, "approve", null, now))).rejects.toThrow(/can't decide/);
    await expect(as(u.sup, (ctx) => decideLeave(ctx, W(u.sup, "SUPERVISOR"), id, "reject", null, now))).rejects.toThrow(/why/);
    const ok = await as(u.sup, (ctx) => decideLeave(ctx, W(u.sup, "SUPERVISOR"), id, "approve", null, now));
    expect(ok.status).toBe("APPROVED");
    await expect(as(u.sup, (ctx) => decideLeave(ctx, W(u.sup, "SUPERVISOR"), id, "approve", null, now))).rejects.toThrow(/already decided/);
    expect((await withTenantTx(T, (tx) => onLeave(tx, [u.driver, u.agent], "2026-03-10"))).has(u.driver)).toBe(true);
    const mine = await as(u.sup, (ctx) => requestLeave(ctx, u.sup, { fromDate: "2026-03-20", toDate: "2026-03-20", type: "casual" }, now));
    await expect(as(u.sup, (ctx) => decideLeave(ctx, W(u.sup, "SUPERVISOR"), mine.id, "approve", null, now))).rejects.toThrow(/Someone else/);
    expect((await as(adminId, (ctx) => decideLeave(ctx, W(adminId, "ADMIN"), mine.id, "approve", null, now))).status).toBe("APPROVED");
  });
});

describe("beats, plans and visits", () => {
  let beatMon = "";
  let beatTue = "";
  it("weekday beats, overridden by a dated plan", async () => {
    beatMon = (await as(u.sup, (ctx) => saveBeat(ctx, null, { name: `Mon ${run}`, salesAgentId: agentProfile, areaId, weekdays: [1, 3], retailerIds: [shops.b, shops.a] }))).id;
    beatTue = (await as(u.sup, (ctx) => saveBeat(ctx, null, { name: `Tue ${run}`, salesAgentId: agentProfile, areaId, weekdays: [2], retailerIds: [shops.c] }))).id;
    await expect(as(u.sup, (ctx) => saveBeat(ctx, null, { name: "x", salesAgentId: agentProfile, areaId, weekdays: [7] }))).rejects.toThrow(/Sunday to Saturday/);
    const mon = "2026-03-09";
    expect((await withTenantTx(T, (tx) => beatForDay(tx, T, agentProfile, mon))).beat?.id).toBe(beatMon);
    await as(u.sup, (ctx) => setBeatPlans(ctx, agentProfile, [{ date: mon, beatId: beatTue }, { date: "2026-03-10", beatId: null, note: "Training" }]));
    expect((await withTenantTx(T, (tx) => beatForDay(tx, T, agentProfile, mon))).beat?.id).toBe(beatTue);
    const training = await withTenantTx(T, (tx) => beatForDay(tx, T, agentProfile, "2026-03-10"));
    expect(training).toMatchObject({ beat: null, source: "plan" });
    await as(u.sup, (ctx) => setBeatPlans(ctx, agentProfile, [{ date: mon, clear: true }]));
    expect((await withTenantTx(T, (tx) => beatForDay(tx, T, agentProfile, mon))).beat?.id).toBe(beatMon);
    const theirs = await as(u.otherSup, (ctx) => saveBeat(ctx, null, { name: `Other ${run}`, salesAgentId: otherProfile, areaId, weekdays: [1], retailerIds: [shops.foreign] }));
    await expect(as(u.sup, (ctx) => setBeatPlans(ctx, agentProfile, [{ date: mon, beatId: theirs.id }]))).rejects.toThrow(/another agent/);
  });

  it("a visit ends with an order or a reason; distance from the shop pin is kept", async () => {
    const day = "2026-03-11"; // Wednesday: the Monday beat
    const who = W(u.agent, "SALES_AGENT");
    const v = await as(u.agent, (ctx) => startVisit(ctx, who, shops.b, { lat: 19.105, lng: 72.852 }, at(day, 10)));
    expect(v.distanceM).toBeGreaterThan(150);
    expect(v.distanceM).toBeLessThan(260);
    expect(v.offBeat).toBe(false);
    expect(v.beatPlanId).toBeNull();
    await expect(as(u.agent, (ctx) => startVisit(ctx, who, shops.a, {}, at(day, 10, 5)))).rejects.toThrow(/Check out of/);
    await expect(as(u.agent, (ctx) => endVisit(ctx, who, v.id, {}, at(day, 10, 10)))).rejects.toThrow(/why/);
    await expect(as(u.agent, (ctx) => endVisit(ctx, who, v.id, { reason: "other" }, at(day, 10, 10)))).rejects.toThrow(/note/);
    const { order } = await as(u.agent, (ctx) => placeOrder(ctx, { retailerId: shops.b, placedById: u.agent, items: [{ productId, quantity: 3 }], visitId: v.id }));
    const done = await as(u.agent, (ctx) => endVisit(ctx, who, v.id, {}, at(day, 10, 15)));
    expect(done).toMatchObject({ outcome: "ORDER", orderId: order.id, noOrderReason: null });
    await expect(as(u.other, (ctx) => endVisit(ctx, W(u.other, "SALES_AGENT"), v.id, { reason: "price" }))).rejects.toThrow(/not found/);
  });

  it("off-beat shops follow the setting", async () => {
    const who = W(u.agent, "SALES_AGENT");
    await setField({ trackLocation: true, offBeat: false });
    await expect(as(u.agent, (ctx) => startVisit(ctx, who, shops.foreign, {}, at("2026-03-12", 10)))).rejects.toThrow(/not on your list/);
    await setField({ trackLocation: true, offBeat: true });
    const v = await as(u.agent, (ctx) => startVisit(ctx, who, shops.foreign, {}, at("2026-03-12", 10)));
    expect(v.offBeat).toBe(true);
    await as(u.agent, (ctx) => endVisit(ctx, who, v.id, { reason: "owner_away" }, at("2026-03-12", 10, 5)));
  });
});

describe("shops added from the field", () => {
  it("checks the details and duplicates, then approval creates the shop", async () => {
    const who = W(u.agent, "SALES_AGENT");
    const base = { outletName: `New shop ${run}`, ownerName: "Owner", phone: phone(300), shopNumber: "5", complexName: "Market", pinCode: "400001", areaId, lat: 19.1, lng: 72.8 };
    await expect(as(u.agent, (ctx) => proposeLead(ctx, who, { ...base, phone: "12345" }))).rejects.toThrow(/10-digit/);
    await expect(as(u.agent, (ctx) => proposeLead(ctx, who, { ...base, fssai: "123" }))).rejects.toThrow(/FSSAI/);
    await expect(as(u.agent, (ctx) => proposeLead(ctx, who, { ...base, gstin: "27ABCDE1234F1Z1" }))).rejects.toThrow(/GSTIN is not valid/); // wrong check digit (…Z0 is valid)
    await expect(as(u.agent, (ctx) => proposeLead(ctx, who, { ...base, phone: phone(101) }))).rejects.toThrow(/already belongs/);
    const lead = await as(u.agent, (ctx) => proposeLead(ctx, who, { ...base, fssai: "11521999000123" }));
    expect(lead).toMatchObject({ status: "PENDING", salesAgentId: agentProfile });
    await expect(as(u.agent, (ctx) => proposeLead(ctx, who, base))).rejects.toThrow(/waiting for approval/);
    await expect(as(adminId, (ctx) => decideLead(ctx, adminId, lead.id, { approve: false }))).rejects.toThrow(/why/);
    const ok = await as(adminId, (ctx) => decideLead(ctx, adminId, lead.id, { approve: true }));
    expect(ok.status).toBe("APPROVED");
    const shop = await tenantDb(T).retailerProfile.findUniqueOrThrow({ where: { id: ok.retailerId! }, include: { user: true } });
    expect(shop).toMatchObject({ outletName: base.outletName, fssai: "11521999000123", salesAgentId: agentProfile, lat: 19.1 });
    expect(shop.user).toMatchObject({ role: "RETAILER", phone: base.phone, name: "Owner" });
    await expect(as(adminId, (ctx) => decideLead(ctx, adminId, lead.id, { approve: true }))).rejects.toThrow(/already decided/);
  });
});

describe("targets and incentives", () => {
  it("validates, measures and pays", async () => {
    const period = istDay().slice(0, 7);
    await expect(as(adminId, (ctx) => saveTarget(ctx, { userId: u.agent, period, metric: "VALUE", goal: 0 }))).rejects.toThrow(/more than 0/);
    await expect(as(adminId, (ctx) => saveTarget(ctx, { userId: u.agent, period, metric: "VALUE", goal: 100, capPct: 90 }))).rejects.toThrow(/Cap/);
    await as(adminId, (ctx) => saveTarget(ctx, { userId: u.agent, period, metric: "VALUE", goal: 100_000, incentive: 10_000 }));
    const again = await as(adminId, (ctx) => saveTarget(ctx, { userId: u.agent, period, metric: "VALUE", goal: 50_000, incentive: 10_000 }));
    expect(again.goal).toBe(50_000);
    await as(adminId, (ctx) => saveTarget(ctx, { userId: u.agent, period, metric: "VOLUME", goal: 4, productId, incentive: 2000 }));
    await as(adminId, (ctx) => saveTarget(ctx, { userId: u.agent, period, metric: "NEW_OUTLETS", goal: 1, incentive: 5000 }));
    // The order placed on the visit above was placed now (this month): 3 units.
    const rows = await withTenantTx(T, (tx) => targetProgress(tx, [u.agent], period));
    expect(rows).toHaveLength(3);
    const value = rows.find((r) => r.metric === "VALUE")!;
    expect(value.achieved).toBeGreaterThan(0);
    const volume = rows.find((r) => r.metric === "VOLUME")!;
    expect(volume).toMatchObject({ achieved: 3, pct: 75, earned: 0 });
    expect(rows.find((r) => r.metric === "NEW_OUTLETS")).toMatchObject({ achieved: 1, pct: 100, earned: 5000 });
    const a = await withTenantTx(T, (tx) => achievements(tx, [u.agent, u.other], period));
    expect(a.value.get(u.other) ?? 0).toBe(0);
    const board = await withTenantTx(T, (tx) => leaderboard(tx, [u.sup, u.agent, u.driver], period, "VALUE"));
    expect(board[0]).toMatchObject({ rank: 1, userId: u.agent, goal: 50_000 });
    expect(board.map((b) => b.userId)).not.toContain(u.sup);
  });
});

describe("team day and reports", () => {
  it("shows the team's day with exceptions", async () => {
    const res = await withTenantTx(T, async (tx) => teamDay(tx, T, await teamScope(tx, W(u.sup, "SUPERVISOR")), DAY, at("2026-03-03", 12)));
    const agent = res.members.find((m) => m.userId === u.agent)!;
    const driver = res.members.find((m) => m.userId === u.driver)!;
    expect(res.members.find((m) => m.userId === u.other)).toBeUndefined();
    expect(agent.attendance?.minutes).toBe(8 * 60 + 20);
    expect(agent.exceptions).toContain("late");
    expect(agent.exceptions).not.toContain("absent");
    expect(agent.visits).toBe(1);
    expect(agent.distanceM).toBeGreaterThan(700);
    expect(driver.exceptions).toContain("absent");
  });

  it("CSV rows only for the team", async () => {
    const rows = await withTenantTx(T, async (tx) => reportRows(tx, await teamScope(tx, W(u.sup, "SUPERVISOR")), "attendance", DAY, DAY));
    expect(rows[0][0]).toBe("Date");
    expect(rows.slice(1).map((r) => r[1])).toEqual([`Agent ${run}`]);
    await expect(withTenantTx(T, (tx) => reportRows(tx, null, "visits", "2026-01-01", "2026-06-01"))).rejects.toThrow(/92 days/);
  });
});

describe("business switch (multi-distributor)", () => {
  it("a signed hop works once, only on the business it names", async () => {
    const token = await signHandoff(phone(3), T, T2);
    await expect(consumeHandoff(token, T)).rejects.toThrow(HandoffError);
    const { user } = await consumeHandoff(token, T2);
    expect(user.id).toBe(secondUserId);
    await expect(consumeHandoff(token, T2)).rejects.toThrow(/already used/);
    await expect(consumeHandoff("not-a-token", T2)).rejects.toThrow(/expired/);
    await expect(consumeHandoff(await signHandoff(phone(999), T, T2), T2)).rejects.toThrow(/active login/);
  });
});
