/**
 * Phase 5 against the real database: goods received in batches, purchase
 * orders, first-expiry-first loading and selling, the order-time stock check,
 * van load sheet → trip → delivery from the van → spot sale → unload, stock
 * that never blocks a delivery, returns back into stock, adjustments, the
 * damaged bin, and the append-only history.
 *
 * Everything is created fresh in the demo tenant; settings are restored afterwards.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx } from "@/lib/db";
import { issueCreditNote, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { quoteCart, retailerPricingCtx, type CartItemInput } from "@/lib/pricing";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { DELIVERY_DEFAULTS } from "@/lib/delivery-settings";
import { deliverOrder, failDelivery, type DeliverInput } from "@/lib/delivery";
import { addOrders, closeTrip, createTrip, startTrip, updateTrip } from "@/lib/trips";
import { spotSale } from "@/lib/spot-sale";
import {
  adjustStock,
  binExpired,
  clearDamaged,
  createPo,
  damagedBin,
  damageStock,
  defaultWarehouse,
  draftReorderPos,
  loadPlan,
  loadVan,
  receiveGoods,
  reorderList,
  restockReturn,
  setPoStatus,
  stockLevels,
  unloadPlan,
  unloadVan,
  vanLocation,
  vanStock,
} from "@/lib/stock";
import { fefoSort, isExpired, istToday, loadLine, pickFefo, reorderSuggestion, roundUpToCase } from "@/lib/stock-math";
import { istDate } from "@/lib/gst";
import { collectScope } from "@/lib/khata";

let T = "";
let adminId = "";
let areaId = "";
let driverId = "";
let driverUserId = "";
let vehicleId = "";
let supplierId = "";
let whId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { a: "", b: "", c: "", cat: "" };
const today = istDate(new Date());
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function setSettings(patch: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...(t.settings as object), ...patch } as object } });
}
const stockCfg = (over: Record<string, unknown> = {}) => ({ inventory: { enabled: true, orderCheck: "warn", bufferPct: 10, expiryAlertDays: 7, ...over } });

async function newRetailer() {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Stock test ${run}-${n}`,
      phone: `5${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Stock test ${run}-${n}`, shopNumber: "1", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

const as = <X>(fn: Parameters<typeof withMoney<X>>[2], who = adminId) => withMoney(T, who, fn);
const place = (retailerId: string, items: CartItemInput[]) => as((ctx) => placeOrder(ctx, { retailerId, placedById: adminId, items })).then((r) => r.order);
const pod = { photo: null, signature: null, lat: null, lng: null, accuracy: null };
const deliver = (orderId: string, over: Partial<DeliverInput> = {}) =>
  as((ctx) => deliverOrder(ctx, { orderId, agentId: driverId, office: false, pod, collect: null, ...over }), driverUserId);
const ZERO = { productId: "", warehouse: 0, van: 0, damaged: 0, expired: 0, reserved: 0, available: 0, value: 0 };
const levels = async (id: string) => (await withTenantTx(T, (tx) => stockLevels(tx, [id]))).get(id) ?? { ...ZERO, productId: id };
const lotsAt = (locationId: string, productId: string) =>
  tenantDb(T).stockLot.findMany({ where: { locationId, productId, qty: { gt: 0 } }, orderBy: { expiry: { sort: "asc", nulls: "last" } } });
const qtyAt = async (locationId: string, productId: string) => (await lotsAt(locationId, productId)).reduce((a, l) => a + l.qty, 0);
const itemOf = async (orderId: string, productId: string) => tenantDb(T).orderItem.findFirstOrThrow({ where: { orderId, productId } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  const driver = await db.user.create({
    data: { name: `Stock driver ${run}`, phone: `8${run}000`, role: "DELIVERY_AGENT", deliveryAgentProfile: { create: {} } },
    include: { deliveryAgentProfile: true },
  });
  driverId = driver.deliveryAgentProfile!.id;
  driverUserId = driver.id;
  vehicleId = (await db.vehicle.create({ data: { number: `MH99ST${run}` } })).id;
  supplierId = (await db.supplier.create({ data: { name: `Test supplier ${run}` } })).id;
  ids.cat = (await db.category.create({ data: { name: `Stock cat ${run}` } })).id;
  const mk = (sku: string, price: number, extra: Record<string, unknown> = {}) =>
    db.product.create({ data: { name: `Test stock ${sku} ${run}`, sku: `STK-${sku}-${run}`, categoryId: ids.cat, unit: "pc", price, mrp: price * 2, gstRate: 5, hsnCode: "0902", ...extra } });
  ids.a = (await mk("A", 10000, { trackExpiry: true, supplierId, reorderLevel: 10, reorderQty: 50 })).id;
  ids.b = (await mk("B", 5000, { supplierId, reorderLevel: 100 })).id;
  ids.c = (await mk("C", 2000)).id;
  await setSettings({
    cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, freeDeliveryAbove: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
    invoice: { ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt: "dispatch", einvoice: { enabled: false, provider: "sandbox" } },
    delivery: DELIVERY_DEFAULTS,
    ...stockCfg(),
  });
  whId = (await as((ctx) => defaultWarehouse(ctx))).id;
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    const db = tenantDb(T);
    await db.product.updateMany({ where: { id: { in: [ids.a, ids.b, ids.c] } }, data: { active: false } });
    await db.user.updateMany({ where: { id: driverUserId }, data: { active: false } });
    await db.vehicle.updateMany({ where: { id: vehicleId }, data: { active: false } });
    await db.supplier.updateMany({ where: { id: supplierId }, data: { active: false } });
  }
});

describe("pure helpers", () => {
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  const lot = (id: string, qty: number, expiry: string | null, received = "2026-01-01") => ({ id, qty, expiry: expiry ? d(expiry) : null, receivedAt: d(received) });

  it("takes first expiry first, skips expired, puts no-expiry last", () => {
    const lots = [lot("none", 50, null), lot("late", 10, "2027-03-01"), lot("old", 5, "2026-01-10"), lot("soon", 4, "2026-12-01")];
    expect(fefoSort(lots).map((l) => l.id)).toEqual(["old", "soon", "late", "none"]);
    const r = pickFefo(lots, 20, { today: d("2026-11-19") });
    expect(r.picks.map((p) => [p.lot.id, p.qty])).toEqual([["soon", 4], ["late", 10], ["none", 6]]);
    expect(r.short).toBe(0);
    expect(pickFefo([lot("x", 3, "2026-12-01")], 5, { today: d("2026-11-19") }).short).toBe(2);
    expect(isExpired(lot("e", 1, "2026-11-19"), d("2026-11-19"))).toBe(false);
    expect(isExpired(lot("e", 1, "2026-11-18"), d("2026-11-19"))).toBe(true);
  });

  it("load sheet, buffer and reorder maths", () => {
    expect(loadLine({ need: 35, otherNeed: 0, inVan: 0, bufferPct: 10 })).toEqual({ buffer: 4, forOrders: 35, suggested: 39 });
    expect(loadLine({ need: 10, otherNeed: 5, inVan: 12, bufferPct: 0 })).toEqual({ buffer: 0, forOrders: 3, suggested: 3 });
    expect(loadLine({ need: 10, otherNeed: 0, inVan: 0, bufferPct: 10, caseSize: 12 })).toEqual({ buffer: 12, forOrders: 10, suggested: 22 });
    expect(roundUpToCase(13, 12)).toBe(24);
    expect(reorderSuggestion({ available: 8, reorderLevel: 10, reorderQty: null })).toBe(12);
    expect(reorderSuggestion({ available: 8, reorderLevel: 10, reorderQty: 50, caseSize: 24 })).toBe(72);
    expect(reorderSuggestion({ available: 11, reorderLevel: 10, reorderQty: 50 })).toBe(0);
  });
});

describe("receiving goods and purchase orders", () => {
  it("refuses a batch without expiry (when tracked) or already expired", async () => {
    await expect(as((ctx) => receiveGoods(ctx, { supplierId, lines: [{ productId: ids.a, quantity: 5 }] }))).rejects.toThrow(/expiry/);
    await expect(as((ctx) => receiveGoods(ctx, { supplierId, lines: [{ productId: ids.a, quantity: 5, expiry: day(-1) }] }))).rejects.toThrow(/already expired/);
  });

  it("receives against a purchase order in two deliveries, batch by batch", async () => {
    const po = await as((ctx) => createPo(ctx, { supplierId, lines: [{ productId: ids.a, quantity: 80, unitCost: 6000 }, { productId: ids.b, quantity: 40 }] }));
    expect(po.number).toMatch(/^PO\d{4}-\d{5}$/);
    await as((ctx) => setPoStatus(ctx, po.id, "SENT"));
    const g1 = await as((ctx) =>
      receiveGoods(ctx, {
        supplierId,
        poId: po.id,
        billNo: "B-1",
        lines: [
          { productId: ids.a, quantity: 30, batch: "A-SOON", expiry: day(10), unitCost: 6000 },
          { productId: ids.a, quantity: 50, batch: "A-LATE", expiry: day(100), unitCost: 6200 },
        ],
      })
    );
    expect(g1.number).toMatch(/^GRN\d{4}-\d{5}$/);
    expect(g1.total).toBe(30 * 6000 + 50 * 6200);
    expect((await tenantDb(T).purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("PARTLY_RECEIVED");
    await as((ctx) => receiveGoods(ctx, { supplierId, poId: po.id, lines: [{ productId: ids.b, quantity: 40 }] }));
    expect((await tenantDb(T).purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status).toBe("RECEIVED");
    expect((await lotsAt(whId, ids.a)).map((l) => [l.batch, l.qty])).toEqual([["A-SOON", 30], ["A-LATE", 50]]);
    expect(await levels(ids.a)).toMatchObject({ warehouse: 80, van: 0, reserved: 0, available: 80 });
    expect((await tenantDb(T).product.findUniqueOrThrow({ where: { id: ids.a } })).lastCost).toBe(6200);
    await expect(as((ctx) => receiveGoods(ctx, { supplierId, poId: po.id, lines: [{ productId: ids.b, quantity: 1 }] }))).rejects.toThrow(/received/);
  });
});

describe("order-time stock check", () => {
  const quote = async (retailerId: string, items: CartItemInput[]) =>
    withTenantTx(T, async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
      return quoteCart(tx, t.settings, (await retailerPricingCtx(tx, retailerId))!, { items });
    });

  it("warns, refuses or ignores per the setting, counting open orders", async () => {
    const r = await newRetailer();
    const warn = await quote(r, [{ productId: ids.a, quantity: 200 }]);
    expect(warn.problems).toEqual([]);
    expect(warn.warnings[0]).toMatch(/only 80 pc in stock/);
    expect(warn.stockShort[ids.a]).toBe(80);
    await setSettings(stockCfg({ orderCheck: "block" }));
    expect((await quote(r, [{ productId: ids.a, quantity: 200 }])).problems[0]).toMatch(/only 80 pc/);
    expect((await quote(r, [{ productId: ids.c, quantity: 1 }])).problems[0]).toMatch(/out of stock/);
    await setSettings(stockCfg({ orderCheck: "off" }));
    expect((await quote(r, [{ productId: ids.c, quantity: 1 }])).warnings).toEqual([]);
    await setSettings(stockCfg());
  });
});

describe("van load → trip → delivery → spot sale → unload", () => {
  let o1 = "";
  let o2 = "";
  let tripId = "";
  let vanId = "";

  it("plans the load with a buffer and loads first expiry first", async () => {
    const r1 = await newRetailer();
    const r2 = await newRetailer();
    o1 = (await place(r1, [{ productId: ids.a, quantity: 20 }, { productId: ids.b, quantity: 10 }])).id;
    o2 = (await place(r2, [{ productId: ids.a, quantity: 15 }])).id;
    expect((await levels(ids.a)).available).toBe(80 - 35);
    tripId = (await as((ctx) => createTrip(ctx, { date: today, slot: "morning", driverId, vehicleId }))).id;
    await as((ctx) => addOrders(ctx, tripId, [o1, o2]));
    const plan = await as((ctx) => loadPlan(ctx, tripId));
    const a = plan.rows.find((x) => x.productId === ids.a)!;
    expect(a).toMatchObject({ need: 35, inVan: 0, buffer: 4, forOrders: 35, suggested: 39, warehouse: 80 });
    expect(a.picks.map((p) => [p.batch, p.qty])).toEqual([["A-SOON", 30], ["A-LATE", 9]]);
    await as((ctx) => loadVan(ctx, tripId, plan.rows.map((x) => ({ productId: x.productId, qty: x.suggested }))));
    vanId = (await as((ctx) => vanLocation(ctx, vehicleId))).id;
    expect((await lotsAt(vanId, ids.a)).map((l) => [l.batch, l.qty])).toEqual([["A-SOON", 30], ["A-LATE", 9]]);
    expect(await qtyAt(vanId, ids.b)).toBe(11);
    expect(await levels(ids.a)).toMatchObject({ warehouse: 41, van: 39, reserved: 35, available: 45 });
    // The van can't change once goods are on it.
    const other = await tenantDb(T).vehicle.create({ data: { number: `MH98ST${run}` } });
    await expect(as((ctx) => updateTrip(ctx, tripId, { vehicleId: other.id }))).rejects.toThrow(/already loaded/);
  });

  it("starts without loading again, then sells from the van at delivery", async () => {
    const before = await tenantDb(T).stockMove.count({ where: { tripId, kind: "LOAD" } });
    await as((ctx) => startTrip(ctx, tripId), driverUserId);
    expect(await tenantDb(T).stockMove.count({ where: { tripId, kind: "LOAD" } })).toBe(before);
    const ia = await itemOf(o1, ids.a);
    await deliver(o1, { lines: [{ itemId: ia.id, quantity: 18, reason: "damaged" }] });
    const sales = await tenantDb(T).stockMove.findMany({ where: { orderId: o1, kind: "SALE" }, include: { lot: true } });
    expect(sales.filter((s) => s.productId === ids.a).map((s) => [s.lot!.batch, s.qty, s.fromId])).toEqual([["A-SOON", 18, vanId]]);
    expect(sales.find((s) => s.productId === ids.b)!.qty).toBe(10);
    expect(await levels(ids.a)).toMatchObject({ van: 21, reserved: 15 });
  });

  it("spot-sells only free van stock", async () => {
    const r3 = await newRetailer();
    // A new shop: the driver may read its dues (to collect on a spot sale) only while on the road.
    const driverSession = { userId: driverUserId, role: "DELIVERY_AGENT", tenantId: T } as Parameters<typeof collectScope>[1];
    expect(await collectScope(tenantDb(T), driverSession, r3)).toMatchObject({ office: false });
    expect((await as((ctx) => vanStock(ctx, vehicleId))).rows.find((x) => x.productId === ids.a)).toMatchObject({ onHand: 21, reserved: 15, free: 6 });
    await expect(
      as((ctx) => spotSale(ctx, { agentId: driverId, driverUserId, retailerId: r3, items: [{ productId: ids.a, quantity: 10 }], pod, collect: null }), driverUserId)
    ).rejects.toThrow(/Not enough free in the van/);
    const sale = await as(
      (ctx) => spotSale(ctx, { agentId: driverId, driverUserId, retailerId: r3, items: [{ productId: ids.a, quantity: 3 }], pod, collect: { amount: 31500, method: "CASH", collectorId: driverUserId } }),
      driverUserId
    );
    const order = await tenantDb(T).order.findUniqueOrThrow({ where: { id: sale.order.id }, include: { delivery: true, invoices: true } });
    expect(order).toMatchObject({ spot: true, status: "DELIVERED" });
    expect(order.delivery).toMatchObject({ tripId, state: "DELIVERED", code: null });
    expect(order.invoices.length).toBe(1);
    expect(await qtyAt(vanId, ids.a)).toBe(18);
  });

  it("closes, then unloads: damaged to the bin, the rest back, the gap booked as missing", async () => {
    await as((ctx) => failDelivery(ctx, o2, { reason: "shop_closed" }), driverUserId);
    await as((ctx) => closeTrip(ctx, tripId));
    const driverSession = { userId: driverUserId, role: "DELIVERY_AGENT", tenantId: T } as Parameters<typeof collectScope>[1];
    expect(await collectScope(tenantDb(T), driverSession, await newRetailer())).toBeNull();
    const plan = await as((ctx) => unloadPlan(ctx, tripId));
    expect(plan.rows.find((x) => x.productId === ids.a)).toMatchObject({ onHand: 18, damaged: 2, good: 16 });
    const res = await as((ctx) =>
      unloadVan(ctx, vehicleId, [
        { productId: ids.a, good: 15, damaged: 2, keep: 0 },
        { productId: ids.b, good: 0, damaged: 0, keep: 1 },
      ], { tripId })
    );
    expect(res.missing).toEqual([{ productId: ids.a, qty: 1 }]);
    const bin = await as((ctx) => damagedBin(ctx));
    expect(await qtyAt(vanId, ids.a)).toBe(0);
    expect(await qtyAt(vanId, ids.b)).toBe(1);
    expect(await qtyAt(bin.id, ids.a)).toBe(2);
    expect(await qtyAt(whId, ids.a)).toBe(41 + 15);
    expect(await tenantDb(T).stockMove.count({ where: { tripId, kind: "ADJUST", reason: "van_shortage" } })).toBe(1);
    // o2 failed: still on order, waiting in the warehouse records.
    expect(await levels(ids.a)).toMatchObject({ warehouse: 56, van: 0, damaged: 2, reserved: 15, available: 41 });
  });

  it("puts a retailer return back into stock in the batch it was sold from, never more than sold", async () => {
    const inv = await tenantDb(T).invoice.findFirstOrThrow({ where: { orderId: o1, type: "TAX_INVOICE" }, include: { lines: true } });
    const ia = await itemOf(o1, ids.a);
    const line = inv.lines.find((l) => l.orderItemId === ia.id)!;
    const back = await as(async (ctx) => {
      const note = await issueCreditNote(ctx, { invoiceId: inv.id, kind: "return", reason: "Shop returned 5", lines: [{ lineId: line.id, quantity: 5 }] });
      return restockReturn(ctx, note.id, "good");
    });
    expect(back).toEqual([{ productId: ids.a, qty: 5 }]);
    const ret = await tenantDb(T).stockMove.findFirstOrThrow({ where: { orderId: o1, kind: "RETURN" }, include: { lot: true } });
    expect([ret.lot!.batch, ret.toId]).toEqual(["A-SOON", whId]);
    // 18 sold, 5 back; the 2 credited at delivery were never sold. Another 15 → only 13 come back.
    const more = await as(async (ctx) => {
      const note = await issueCreditNote(ctx, { invoiceId: inv.id, kind: "return", reason: "More back", lines: [{ lineId: line.id, quantity: 13 }] });
      return restockReturn(ctx, note.id, "damaged");
    });
    expect(more).toEqual([{ productId: ids.a, qty: 13 }]);
  });
});

describe("stock never blocks a delivery, but loading checks the warehouse", () => {
  it("refuses to start a trip the warehouse can't cover, unless overridden", async () => {
    const r = await newRetailer();
    const o = (await place(r, [{ productId: ids.c, quantity: 6 }])).id;
    const t = (await as((ctx) => createTrip(ctx, { date: today, slot: "evening", driverId, vehicleId }))).id;
    await as((ctx) => addOrders(ctx, t, [o]));
    await expect(as((ctx) => startTrip(ctx, t), driverUserId)).rejects.toThrow(/Not enough in/);
    await as((ctx) => startTrip(ctx, t, new Date(), { stockOverride: true }));
    expect(await tenantDb(T).stockMove.count({ where: { tripId: t, kind: "ADJUST", reason: "loaded_unrecorded" } })).toBe(1);
    await deliver(o);
    await as((ctx) => closeTrip(ctx, t));
    expect((await levels(ids.c)).van).toBe(0);
  });

  it("an office delivery with no stock recorded books the gap and still delivers", async () => {
    const r = await newRetailer();
    const o = (await place(r, [{ productId: ids.c, quantity: 4 }])).id;
    await as((ctx) => deliverOrder(ctx, { orderId: o, agentId: null, office: true, pod, collect: null }));
    const adj = await tenantDb(T).stockMove.findFirstOrThrow({ where: { orderId: o, kind: "ADJUST" } });
    expect([adj.reason, adj.qty, adj.toId]).toEqual(["sold_unrecorded", 4, whId]);
    expect(await qtyAt(whId, ids.c)).toBe(0);
  });

  it("moves no stock when tracking is off", async () => {
    await setSettings({ inventory: { enabled: false } });
    const r = await newRetailer();
    const o = (await place(r, [{ productId: ids.b, quantity: 2 }])).id;
    await as((ctx) => deliverOrder(ctx, { orderId: o, agentId: null, office: true, pod, collect: null }));
    expect(await tenantDb(T).stockMove.count({ where: { orderId: o } })).toBe(0);
    await setSettings(stockCfg());
  });
});

describe("adjustments, damaged bin, reorder and history", () => {
  it("adjusts with a reason, moves expired stock to the bin, writes it off", async () => {
    await expect(as((ctx) => adjustStock(ctx, { locationId: whId, productId: ids.b, delta: -1, reason: "nope" }))).rejects.toThrow(/reason/);
    await expect(as((ctx) => adjustStock(ctx, { locationId: whId, productId: ids.b, delta: -1, reason: "other" }))).rejects.toThrow(/Write what happened/);
    const b0 = await qtyAt(whId, ids.b);
    await as((ctx) => adjustStock(ctx, { locationId: whId, productId: ids.b, delta: -3, reason: "lost", note: "Rats" }));
    expect(await qtyAt(whId, ids.b)).toBe(b0 - 3);
    await expect(as((ctx) => adjustStock(ctx, { locationId: whId, productId: ids.b, delta: -10_000, reason: "count" }))).rejects.toThrow(/Only/);
    await as((ctx) => adjustStock(ctx, { locationId: whId, productId: ids.a, delta: 4, reason: "opening", batch: "A-OLD", expiry: day(-2) }));
    expect((await levels(ids.a)).expired).toBe(4);
    const moved = await as((ctx) => binExpired(ctx));
    expect(moved).toBeGreaterThanOrEqual(1);
    const bin = await as((ctx) => damagedBin(ctx));
    expect((await levels(ids.a)).expired).toBe(0);
    await as((ctx) => damageStock(ctx, { locationId: whId, productId: ids.b, qty: 2, reason: "leaking" }));
    const binB = await qtyAt(bin.id, ids.b);
    await as((ctx) => clearDamaged(ctx, { productId: ids.b, qty: binB, to: "SUPPLIER_RETURN", supplierId }));
    expect(await qtyAt(bin.id, ids.b)).toBe(0);
  });

  it("lists products to reorder and drafts a purchase order per supplier", async () => {
    const rows = await withTenantTx(T, (tx) => reorderList(tx));
    const b = rows.find((r) => r.productId === ids.b)!;
    expect(b.available).toBeLessThanOrEqual(100);
    expect(b.suggested).toBeGreaterThan(0);
    const { pos } = await as((ctx) => draftReorderPos(ctx, [ids.b]));
    expect(pos).toHaveLength(1);
    expect(pos[0].lines[0]).toMatchObject({ productId: ids.b, quantity: b.suggested });
    const again = (await withTenantTx(T, (tx) => reorderList(tx))).find((r) => r.productId === ids.b)!;
    expect(again.onOrder).toBe(b.suggested);
    expect(again.suggested).toBe(reorderSuggestion({ available: again.available + again.onOrder, reorderLevel: 100, reorderQty: null }));
  });

  it("keeps the history append-only and lots never below zero", async () => {
    const m = await tenantDb(T).stockMove.findFirstOrThrow({ where: { productId: ids.a } });
    await expect(withTenantTx(T, (tx) => tx.stockMove.update({ where: { id: m.id }, data: { qty: 999 } }))).rejects.toThrow();
    await expect(withTenantTx(T, (tx) => tx.stockMove.delete({ where: { id: m.id } }))).rejects.toThrow();
    const lot = (await lotsAt(whId, ids.a))[0];
    await expect(withTenantTx(T, (tx) => tx.stockLot.update({ where: { id: lot.id }, data: { qty: -1 } }))).rejects.toThrow();
    expect(istToday().toISOString()).toMatch(/T00:00:00.000Z$/);
  });
});
