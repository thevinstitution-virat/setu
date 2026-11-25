/**
 * A scheme (₹ off) or deal (10+1) the office types on one line of an order
 * before it is billed: the line's discount, the free-goods line, the order's
 * totals (with rates before and including GST), the invoice matching the
 * order, and the limits. Fresh products and shops in the demo tenant;
 * settings are restored afterwards.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { MoneyError, onOrderDispatched, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { setLineScheme, type LineSchemeInput } from "@/lib/order-scheme";
import { dealFree, parseDeal } from "@/lib/deal";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { lineMoney } from "@/lib/money";
import type { CartItemInput } from "@/lib/pricing";

let T = "";
let adminId = "";
let areaId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { tea: "", soap: "", cat: "", shop: "" };

async function setSettings(patch: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...(t.settings as object), ...patch } as object } });
}
const invoiceCfg = (over: Record<string, unknown> = {}) => ({ ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt: "dispatch", ...over });

async function newShop() {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Line scheme ${run}-${n}`,
      phone: `4${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Line scheme ${run}-${n}`, shopNumber: "3", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

const place = (items: CartItemInput[]) => withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId: ids.shop, placedById: adminId, items })).then((r) => r.order);
const setLine = (orderId: string, itemId: string, input: LineSchemeInput) => withMoney(T, adminId, (ctx) => setLineScheme(ctx, orderId, itemId, input));
const fails = (p: Promise<unknown>) => p.then(() => null, (e) => (e instanceof MoneyError ? `${e.status}: ${e.message}` : String(e)));

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  ids.cat = (await db.category.create({ data: { name: `Line scheme cat ${run}` } })).id;
  ids.tea = (await db.product.create({ data: { name: `Test scheme tea ${run}`, sku: `LS-TEA-${run}`, categoryId: ids.cat, unit: "pc", price: 10000, mrp: 15000, gstRate: 5, hsnCode: "0902" } })).id;
  ids.soap = (
    await db.product.create({
      data: { name: `Test scheme soap ${run}`, sku: `LS-SOAP-${run}`, categoryId: ids.cat, unit: "pc", price: 5000, mrp: 8000, gstRate: 18, hsnCode: "3401", caseUnit: "box", caseSize: 12 },
    })
  ).id;
  ids.shop = await newShop();
  await setSettings({
    cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, freeDeliveryAbove: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
    invoice: invoiceCfg(),
  });
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).product.updateMany({ where: { id: { in: [ids.tea, ids.soap] } }, data: { active: false } });
  }
});

describe("deals", () => {
  it("reads 10+1 and counts whole sets (cases on a line ordered in cases)", () => {
    expect(parseDeal("10+1")).toEqual({ buy: 10, get: 1 });
    expect(parseDeal(" 24 + 2 ")).toEqual({ buy: 24, get: 2 });
    expect(parseDeal("")).toBeNull();
    for (const bad of ["10", "0+1", "10+0", "a+b", "10+1+1"]) expect(parseDeal(bad)).toBe("bad");
    expect(dealFree({ quantity: 25 }, { buy: 10, get: 1 })).toBe(2);
    expect(dealFree({ quantity: 120, cases: 10, caseSize: 12 }, { buy: 5, get: 1 })).toBe(24);
  });
});

describe("scheme and deal on an order line", () => {
  it("takes the scheme off the line, adds the free goods and works the totals out again", async () => {
    const order = await place([{ productId: ids.tea, quantity: 20 }, { productId: ids.soap, quantity: 5 }]);
    const tea = order.items.find((i) => i.productId === ids.tea)!;
    const soap = order.items.find((i) => i.productId === ids.soap)!;
    expect(order.totalAmount).toBe(210000 + 29500);

    // Re-pricing with nothing changed keeps the order as placed.
    const same = await setLine(order.id, soap.id, { scheme: 0, deal: null });
    expect(same.totalAmount).toBe(order.totalAmount);

    const o1 = await setLine(order.id, tea.id, { scheme: 5000, deal: { buy: 10, get: 1 } });
    const t1 = o1.items.find((i) => i.id === tea.id)!;
    expect(t1).toMatchObject({ discount: 5000, extraScheme: 5000, dealBuy: 10, dealGet: 1 });
    const free1 = o1.items.filter((i) => i.dealForItemId === tea.id);
    expect(free1).toHaveLength(1);
    expect(free1[0]).toMatchObject({ productId: ids.tea, quantity: 2, price: 0 });
    // Tea 200000 − 5000 = 195000 + 5% = 9750; soap 25000 + 18% = 4500.
    expect(o1).toMatchObject({ grossAmount: 225000, discountAmount: 5000, subtotal: 220000, gstAmount: 14250, totalAmount: 234250 });

    // Changing it replaces the free line; clearing the scheme gives the discount back.
    const o2 = await setLine(order.id, tea.id, { scheme: 0, deal: { buy: 5, get: 1 } });
    expect(o2.items.filter((i) => i.dealForItemId === tea.id).map((i) => i.quantity)).toEqual([4]);
    expect(o2.items.find((i) => i.id === tea.id)).toMatchObject({ discount: 0, extraScheme: 0 });
    expect(o2.totalAmount).toBe(order.totalAmount);
    const o3 = await setLine(order.id, tea.id, { scheme: 2500, deal: null });
    expect(o3.items.filter((i) => i.dealForItemId)).toHaveLength(0);
    expect(o3.totalAmount).toBe(order.totalAmount - 2500 - 125);

    // Limits.
    expect(await fails(setLine(order.id, tea.id, { scheme: 200000, deal: null }))).toMatch(/^400: The scheme is more than the line/);
    expect(await fails(setLine(order.id, tea.id, { scheme: 0, deal: { buy: 50, get: 1 } }))).toMatch(/gives nothing/);
    const o4 = await setLine(order.id, tea.id, { scheme: 2500, deal: { buy: 10, get: 1 } });
    const freeLine = o4.items.find((i) => i.dealForItemId === tea.id)!;
    expect(await fails(setLine(order.id, freeLine.id, { scheme: 100, deal: null }))).toMatch(/free goods/);
    expect(await fails(setLine(order.id, "nope", { scheme: 100, deal: null }))).toMatch(/^404/);

    // Billed: the invoice equals the order and carries the free goods; no changes after.
    await withMoney(T, adminId, (ctx) => onOrderDispatched(ctx, order.id));
    const inv = await tenantDb(T).invoice.findFirstOrThrow({ where: { orderId: order.id, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } }, include: { lines: true } });
    expect(inv.total).toBe(o4.totalAmount);
    expect(inv.lines.find((l) => l.freeQty > 0)).toMatchObject({ quantity: 2, freeQty: 2, taxable: 0 });
    expect(await fails(setLine(order.id, tea.id, { scheme: 0, deal: null }))).toMatch(/^409/);
  });

  it("counts cases on a line ordered in cases, and works with rates that include GST", async () => {
    await setSettings({ invoice: invoiceCfg({ ratesIncludeGst: true }) });
    try {
      const order = await place([{ productId: ids.soap, cases: 10 }]);
      expect(order.taxInclusive).toBe(true);
      const soap = order.items[0];
      const o = await setLine(order.id, soap.id, { scheme: 11800, deal: { buy: 5, get: 1 } });
      expect(o.items.find((i) => i.dealForItemId === soap.id)?.quantity).toBe(24);
      // 120 × ₹50 incl. GST = 600000 − 11800 = 588200 incl. GST.
      const m = lineMoney(5000, 120, 11800, 18, true);
      expect(o.totalAmount).toBe(m.total);
      await withMoney(T, adminId, (ctx) => onOrderDispatched(ctx, order.id));
      const inv = await tenantDb(T).invoice.findFirstOrThrow({ where: { orderId: order.id, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } } });
      expect(inv.total).toBe(o.totalAmount);
    } finally {
      await setSettings({ invoice: invoiceCfg() });
    }
  });
});
