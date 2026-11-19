/**
 * Phase 4 against the real database: trips (create, load, route order,
 * start, close), line-level delivery with exact money (credit note when
 * invoiced at dispatch, cut order when invoiced at delivery), prepaid wallet
 * settlement after a short delivery, failed stops, delivery codes, crates and
 * the day-close summary.
 *
 * Everything is created fresh in the demo tenant; settings are restored afterwards.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, recordPayment, retailerBalances, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { DELIVERY_DEFAULTS } from "@/lib/delivery-settings";
import { chargeReturnables, deliverOrder, failDelivery, repriceOrder, returnableBalances, type DeliverInput } from "@/lib/delivery";
import { addOrders, autoSequence, closeTrip, createTrip, sequenceStops, startTrip, tripSummary } from "@/lib/trips";
import { istDate } from "@/lib/gst";
import type { CartItemInput } from "@/lib/pricing";

let T = "";
let adminId = "";
let areaId = "";
let driverId = "";
let driverUserId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { tea: "", soap: "", cat: "", crate: "" };
const today = istDate(new Date());

async function setSettings(patch: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...(t.settings as object), ...patch } as object } });
}
const invoiceCfg = (issueAt: "dispatch" | "delivery") => ({ ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt, einvoice: { enabled: false, provider: "sandbox" } });

async function newRetailer(extra: Record<string, unknown> = {}) {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Trip test ${run}-${n}`,
      phone: `6${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Trip test ${run}-${n}`, shopNumber: "3", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null, ...extra } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

const place = (retailerId: string, items: CartItemInput[]) =>
  withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId, placedById: adminId, items })).then((r) => r.order);
const trip = () => withMoney(T, adminId, (ctx) => createTrip(ctx, { date: today, slot: "morning", driverId }));
const load = (tripId: string, orderIds: string[]) => withMoney(T, adminId, (ctx) => addOrders(ctx, tripId, orderIds));
const start = (tripId: string) => withMoney(T, driverUserId, (ctx) => startTrip(ctx, tripId));
const pod = { photo: null, signature: null, lat: null, lng: null, accuracy: null };
const deliver = (orderId: string, over: Partial<DeliverInput> = {}) =>
  withMoney(T, driverUserId, (ctx) => deliverOrder(ctx, { orderId, agentId: driverId, office: false, pod, collect: null, ...over }));
const itemsOf = (orderId: string) => tenantDb(T).orderItem.findMany({ where: { orderId }, include: { product: { select: { sku: true } } } });
const itemFor = async (orderId: string, productId: string) => (await itemsOf(orderId)).find((i) => i.productId === productId)!;
const receivable = (retailerId: string) => withMoney(T, null, (ctx) => balanceOf(ctx, { type: "RECEIVABLE", retailerId }));

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  const driver = await db.user.create({
    data: { name: `Driver ${run}`, phone: `7${run}000`, role: "DELIVERY_AGENT", deliveryAgentProfile: { create: {} } },
    include: { deliveryAgentProfile: true },
  });
  driverId = driver.deliveryAgentProfile!.id;
  driverUserId = driver.id;
  ids.cat = (await db.category.create({ data: { name: `Trip cat ${run}` } })).id;
  const mk = (sku: string, price: number, gstRate: number, hsnCode: string) =>
    db.product.create({ data: { name: `Test trip ${sku} ${run}`, sku: `TRP-${sku}-${run}`, categoryId: ids.cat, unit: "pc", price, mrp: price * 2, gstRate, hsnCode } });
  ids.tea = (await mk("TEA", 10000, 5, "0902")).id;
  ids.soap = (await mk("SOAP", 5000, 18, "3401")).id;
  ids.crate = (await db.returnable.create({ data: { name: `Crate ${run}`, unitCharge: 15000 } })).id;
  await setSettings({
    cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 3000, freeDeliveryAbove: 100_000_00, deliveryGstRate: 18, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
    invoice: invoiceCfg("dispatch"),
    delivery: DELIVERY_DEFAULTS,
  });
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    const db = tenantDb(T);
    await db.product.updateMany({ where: { id: { in: [ids.tea, ids.soap] } }, data: { active: false } });
    await db.returnable.updateMany({ where: { id: ids.crate }, data: { active: false } });
    await db.user.updateMany({ where: { id: driverUserId }, data: { active: false } });
  }
});

describe("pure helpers", () => {
  it("orders stops nearest-first, then unlocated by area and PIN code", () => {
    const depot = { lat: 19.0, lng: 72.8 };
    const out = sequenceStops(
      [
        { id: "far", lat: 19.3, lng: 72.8, area: "A", pinCode: "1", name: "Far" },
        { id: "none-b", lat: null, lng: null, area: "B", pinCode: "2", name: "x" },
        { id: "near", lat: 19.01, lng: 72.8, area: "A", pinCode: "1", name: "Near" },
        { id: "mid", lat: 19.1, lng: 72.8, area: "A", pinCode: "1", name: "Mid" },
        { id: "none-a", lat: null, lng: null, area: "A", pinCode: "9", name: "y" },
      ],
      depot
    );
    expect(out.map((p) => p.id)).toEqual(["near", "mid", "far", "none-a", "none-b"]);
  });

  it("cuts an order to the delivered quantities with the discount in proportion", () => {
    const item = (id: string, quantity: number, price: number, gstRate: number, discount: number) => ({ id, quantity, price, gstRate, discount, freeSchemeId: null, orderedQty: null, cases: null, caseSize: null });
    const r = repriceOrder({ deliveryCharge: 3000, deliveryGstRate: 18 }, [
      { item: item("a", 4, 10000, 5, 4000), delivered: 3 },
      { item: item("b", 2, 5000, 18, 0), delivered: 2 },
    ]);
    expect(r.items[0]).toMatchObject({ quantity: 3, discount: 3000 });
    expect(r.grossAmount).toBe(40000);
    expect(r.discountAmount).toBe(3000);
    expect(r.subtotal).toBe(40000 - 3000 + 3000);
    // 27000 @5% = 1350, 10000 @18% = 1800, delivery 3000 @18% = 540
    expect(r.gstAmount).toBe(1350 + 1800 + 540);
  });
});

describe("trip invoiced at dispatch", () => {
  it("loads, starts, delivers short with a credit note, fails a stop and closes", async () => {
    const r1 = await newRetailer({ lat: 19.2, lng: 72.9 });
    const r2 = await newRetailer({ lat: 19.05, lng: 72.85 });
    const a = await place(r1, [{ productId: ids.tea, quantity: 4 }, { productId: ids.soap, quantity: 2 }]);
    const b = await place(r2, [{ productId: ids.tea, quantity: 1 }]);
    const t = await trip();
    expect(t.number).toMatch(/^TRP\d{4}-\d{5}$/);
    await load(t.id, [a.id, b.id]);

    await setSettings({ delivery: { ...DELIVERY_DEFAULTS, depot: { lat: 19.0, lng: 72.8 } } });
    await withMoney(T, adminId, (ctx) => autoSequence(ctx, t.id));
    const seq = await tenantDb(T).delivery.findMany({ where: { tripId: t.id }, orderBy: { seq: "asc" } });
    expect(seq.map((s) => s.orderId)).toEqual([b.id, a.id]); // r2 is nearer the depot

    const started = await start(t.id);
    expect(started.docs).toHaveLength(2);
    const orders = await tenantDb(T).order.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(orders.every((o) => o.status === "OUT_FOR_DELIVERY")).toBe(true);
    expect(await tenantDb(T).dutyShift.findFirst({ where: { userId: driverUserId, endAt: null } })).not.toBeNull();

    // Nothing handed over → refused; a short line without a reason → refused.
    const soap = await itemFor(a.id, ids.soap);
    const tea = await itemFor(a.id, ids.tea);
    await expect(deliver(a.id, { lines: [{ itemId: soap.id, quantity: 0, reason: "damaged" }, { itemId: tea.id, quantity: 0, reason: "damaged" }] })).rejects.toThrow(/Not delivered/);
    await expect(deliver(a.id, { lines: [{ itemId: soap.id, quantity: 1 }] })).rejects.toThrow(/reason/);

    const out = await deliver(a.id, {
      lines: [{ itemId: soap.id, quantity: 1, reason: "damaged" }],
      returnables: [{ returnableId: ids.crate, given: 5, taken: 2 }],
      collect: { amount: 20000, method: "CASH", collectorId: driverUserId },
    });
    const inv = await tenantDb(T).invoice.findFirstOrThrow({ where: { orderId: a.id, type: "TAX_INVOICE" } });
    expect(out.creditNote).not.toBeNull();
    expect(out.creditNote!.noteKind).toBe("return");
    expect(out.creditNote!.total).toBe(5000 + 900); // one soap: 5000 + 18%
    expect(out.totalAmount).toBe(inv.total - 5900);
    expect(await receivable(r1)).toBe(inv.total - 5900 - 20000);
    expect((await itemFor(a.id, ids.soap)).deliveredQty).toBe(1);
    expect((await itemFor(a.id, ids.tea)).deliveredQty).toBe(4);
    // The order keeps its ordered amounts; documents carry the money.
    expect((await tenantDb(T).order.findUniqueOrThrow({ where: { id: a.id } })).totalAmount).toBe(inv.total);

    await expect(withMoney(T, driverUserId, (ctx) => failDelivery(ctx, b.id, { reason: "nonsense" }))).rejects.toThrow(/reason/);
    await withMoney(T, driverUserId, (ctx) => failDelivery(ctx, b.id, { reason: "shop_closed" }));
    const bAfter = await tenantDb(T).order.findUniqueOrThrow({ where: { id: b.id }, include: { delivery: true } });
    expect(bAfter.status).toBe("PACKED");
    expect(bAfter.delivery!.state).toBe("FAILED");
    await expect(deliver(b.id)).rejects.toThrow(/isn't open/);

    // Can't go on another trip while this one is open.
    const t2 = await trip();
    await expect(load(t2.id, [b.id])).rejects.toThrow(/already on trip/);

    const summary = await withMoney(T, adminId, (ctx) => closeTrip(ctx, t.id));
    expect(summary).toMatchObject({ stops: 2, delivered: 1, failed: 1, pending: 0, cashExpected: 20000 });
    const soapRow = summary.products.find((p) => p.productId === ids.soap)!;
    expect(soapRow).toMatchObject({ loaded: 2, delivered: 1, returned: 1 });
    const teaRow = summary.products.find((p) => p.productId === ids.tea)!;
    expect(teaRow).toMatchObject({ loaded: 5, delivered: 4, returned: 1 });
    expect(summary.returnables).toEqual([{ returnableId: ids.crate, name: `Crate ${run}`, given: 5, taken: 2 }]);
    expect(summary.value.delivered).toBe(inv.total - 5900);
    expect(summary.failedStops[0]).toMatchObject({ orderNumber: b.orderNumber, reason: "shop_closed" });
    const closed = await tenantDb(T).trip.findUniqueOrThrow({ where: { id: t.id } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closeSummary).toBeTruthy();

    // Now the failed order can go out again, on the same invoice.
    await load(t2.id, [b.id]);
    const again = await start(t2.id);
    expect(again.docs).toHaveLength(0);
    expect(await tenantDb(T).invoice.count({ where: { orderId: b.id, type: "TAX_INVOICE" } })).toBe(1);
  });

  it("refuses to close with open stops unless forced", async () => {
    const r = await newRetailer();
    const o = await place(r, [{ productId: ids.tea, quantity: 1 }]);
    const t = await trip();
    await load(t.id, [o.id]);
    await start(t.id);
    await expect(withMoney(T, adminId, (ctx) => closeTrip(ctx, t.id))).rejects.toThrow(/still open/);
    const s = await withMoney(T, adminId, (ctx) => closeTrip(ctx, t.id, { force: true }));
    expect(s).toMatchObject({ failed: 1, delivered: 0 });
    expect((await tenantDb(T).order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("PACKED");
  });

  it("settles a prepaid order from the wallet for what was handed over only", async () => {
    const r = await newRetailer({ paymentMode: "PREPAID" });
    await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: r, amount: 100_000, method: "UPI", purpose: "WALLET", atOffice: true }));
    const o = await place(r, [{ productId: ids.tea, quantity: 2 }]);
    expect((await tenantDb(T).order.findUniqueOrThrow({ where: { id: o.id } })).walletHold).toBe(o.totalAmount);
    const t = await trip();
    await load(t.id, [o.id]);
    await start(t.id);
    const tea = await itemFor(o.id, ids.tea);
    const out = await deliver(o.id, { lines: [{ itemId: tea.id, quantity: 1, reason: "refused" }] });
    expect(out.creditNote!.total).toBe(10000 + 500);
    const b = await withMoney(T, null, (ctx) => retailerBalances(ctx, r));
    expect(b.receivable).toBe(0);
    expect(b.walletAvailable).toBe(100_000 - (o.totalAmount - 10500));
  });
});

describe("invoice at delivery", () => {
  it("invoices only what was handed over and keeps the ordered total", async () => {
    await setSettings({ invoice: invoiceCfg("delivery") });
    try {
      const r = await newRetailer();
      const o = await place(r, [{ productId: ids.tea, quantity: 4 }, { productId: ids.soap, quantity: 2 }]);
      const t = await trip();
      await load(t.id, [o.id]);
      const s = await start(t.id);
      expect(s.docs).toHaveLength(0);
      const tea = await itemFor(o.id, ids.tea);
      const out = await deliver(o.id, { lines: [{ itemId: tea.id, quantity: 3, reason: "expired" }] });
      expect(out.creditNote).toBeNull();
      // tea 3 × 100 + 5%, soap 2 × 50 + 18%, delivery 30 + 18%
      const expected = 30000 + 1500 + 10000 + 1800 + 3000 + 540;
      expect(out.totalAmount).toBe(expected);
      const order = await tenantDb(T).order.findUniqueOrThrow({ where: { id: o.id } });
      expect(order.totalAmount).toBe(expected);
      expect(order.orderedTotal).toBe(o.totalAmount);
      const inv = await tenantDb(T).invoice.findFirstOrThrow({ where: { orderId: o.id, type: "TAX_INVOICE" }, include: { lines: true } });
      expect(inv.total).toBe(expected);
      expect(inv.lines.find((l) => l.productId === ids.tea)!.quantity).toBe(3);
      expect(await receivable(r)).toBe(expected);
      const teaAfter = await itemFor(o.id, ids.tea);
      expect(teaAfter).toMatchObject({ quantity: 3, orderedQty: 4, deliveredQty: 3, shortReason: "expired" });
      const sum = await withMoney(T, adminId, (ctx) => tripSummary(ctx, t.id));
      expect(sum.value.loaded).toBe(o.totalAmount);
      expect(sum.products.find((p) => p.productId === ids.tea)).toMatchObject({ loaded: 4, delivered: 3, returned: 1 });
    } finally {
      await setSettings({ invoice: invoiceCfg("dispatch") });
    }
  });
});

describe("delivery code", () => {
  it("asks for the retailer's code on high-value drops", async () => {
    await setSettings({ delivery: { ...DELIVERY_DEFAULTS, codeAbove: 1000 } });
    try {
      const r = await newRetailer();
      const o = await place(r, [{ productId: ids.soap, quantity: 1 }]);
      const t = await trip();
      await load(t.id, [o.id]);
      await start(t.id);
      const d = await tenantDb(T).delivery.findUniqueOrThrow({ where: { orderId: o.id } });
      expect(d.code).toMatch(/^\d{4}$/);
      await expect(deliver(o.id)).rejects.toThrow(/delivery code/);
      await expect(deliver(o.id, { code: d.code === "0000" ? "1111" : "0000" })).rejects.toThrow(/wrong/);
      await deliver(o.id, { code: d.code });
      expect((await tenantDb(T).delivery.findUniqueOrThrow({ where: { orderId: o.id } })).codeVerified).toBe(true);
    } finally {
      await setSettings({ delivery: DELIVERY_DEFAULTS });
    }
  });
});

describe("crates and jars", () => {
  it("keeps balances, bills shortages and never edits history", async () => {
    const r = await newRetailer();
    const o = await place(r, [{ productId: ids.tea, quantity: 1 }]);
    const t = await trip();
    await load(t.id, [o.id]);
    await start(t.id);
    await deliver(o.id, { returnables: [{ returnableId: ids.crate, given: 4, taken: 0 }] });
    const bal = async () => (await withMoney(T, null, (ctx) => returnableBalances(ctx, r))).find((b) => b.returnableId === ids.crate)?.balance ?? 0;
    expect(await bal()).toBe(4);
    const before = await receivable(r);
    await expect(withMoney(T, adminId, (ctx) => chargeReturnables(ctx, r, ids.crate, 5))).rejects.toThrow(/holds only 4/);
    const bill = await withMoney(T, adminId, (ctx) => chargeReturnables(ctx, r, ids.crate, 3, "Broken"));
    expect(bill.amount).toBe(3 * 15000);
    expect(await receivable(r)).toBe(before + 45000);
    expect(await bal()).toBe(1);
    const move = await tenantDb(T).returnableMove.findFirstOrThrow({ where: { retailerId: r } });
    await expect(tenantDb(T).returnableMove.update({ where: { id: move.id }, data: { given: 0 } })).rejects.toThrow();
  });
});
