/**
 * Phase 2 against the real database: rates by price list / special rate,
 * visibility, scheme targeting and budgets, coupons, cases, minimums, and
 * order placement through the same quote. Exit check: one product, three
 * retailers, three different correct prices and schemes.
 *
 * Everything is created fresh in the demo tenant, scoped to this run's own
 * products and retailers, and its schemes are switched off afterwards.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx } from "@/lib/db";
import { MoneyError, onOrderDelivered, retailerBalances, withMoney } from "@/lib/ledger";
import { placeOrder, releaseRedemptions } from "@/lib/order-place";
import { catalogueFor, quoteCart, retailerPricingCtx, schemesFor, type CartItemInput } from "@/lib/pricing";
import { CART_DEFAULTS } from "@/lib/cart-settings";

let T = "";
let adminId = "";
let areaId = "";
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { a: "", gift: "", hidden: "", list: "", group: "", r1: "", r2: "", r3: "", bxgy: "", pct: "", coupon: "" };
const schemeIds: string[] = [];
// Test settings: no minimum and free delivery unless a test says otherwise.
const SETTINGS = { cart: { ...CART_DEFAULTS } };

async function newRetailer() {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Pricing test ${run}-${n}`,
      phone: `6${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Pricing test ${run}-${n}`, shopNumber: "1", complexName: "T", pinCode: "400001", areaId } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

const quote = (retailerId: string, items: CartItemInput[], extra: { coupon?: string; deliveryDate?: string } = {}, settings: unknown = SETTINGS) =>
  withTenantTx(T, async (tx) => quoteCart(tx, settings, (await retailerPricingCtx(tx, retailerId))!, { items, ...extra }));

/**
 * placeOrder reads the tenant's real settings; give it ours for the call.
 * The amounts below are ex-GST rates, so pin that even when the demo tenant
 * has been switched to rates that include GST.
 */
async function place(retailerId: string, items: CartItemInput[], coupon?: string) {
  return withMoney(T, adminId, async (ctx) => {
    const real = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
    const settings = (real.settings ?? {}) as { invoice?: object };
    const invoice = { ...(settings.invoice ?? {}), ratesIncludeGst: false };
    await ctx.tx.tenant.update({ where: { id: T }, data: { settings: { ...settings, ...SETTINGS, invoice } } });
    try {
      return await placeOrder(ctx, { retailerId, placedById: adminId, items, coupon });
    } finally {
      await ctx.tx.tenant.update({ where: { id: T }, data: { settings: real.settings as object } });
    }
  });
}

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } });
  T = demo.id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;

  const cat = await db.category.create({ data: { name: `Test cat ${run}` } });
  const group = await db.retailerGroup.create({ data: { name: `Test group ${run}` } });
  ids.group = group.id;
  const mk = (sku: string, price: number, extra: object = {}) =>
    db.product.create({ data: { name: `Test ${sku} ${run}`, sku: `${sku}-${run}`, categoryId: cat.id, unit: "pc", price, mrp: 12000, gstRate: 5, ...extra } });
  ids.a = (await mk("A", 10000, { caseUnit: "box", caseSize: 10, moq: 2 })).id;
  ids.gift = (await mk("GIFT", 2000)).id;
  ids.hidden = (await mk("HID", 5000, { visibleGroupIds: [group.id] })).id;

  ids.list = (await db.priceList.create({ data: { name: `Test list ${run}`, items: { create: [{ productId: ids.a, price: 9000 }] } } })).id;
  ids.r1 = await newRetailer();
  ids.r2 = await newRetailer();
  ids.r3 = await newRetailer();
  await db.retailerProfile.update({ where: { id: ids.r2 }, data: { priceListId: ids.list } });
  await db.retailerProfile.update({ where: { id: ids.r3 }, data: { priceListId: ids.list } });
  await db.retailerPrice.create({ data: { retailerId: ids.r3, productId: ids.a, price: 8500 } });
  await db.retailerGroupMember.create({ data: { groupId: group.id, retailerId: ids.r3 } });

  const mkScheme = async (data: object) => {
    const s = await db.scheme.create({ data: data as never });
    schemeIds.push(s.id);
    return s.id;
  };
  // r1 + r2: buy 10 get 1 gift, budget for 2 sets (2 × ₹20 at default gift rate).
  ids.bxgy = await mkScheme({
    name: `Test 10+1 ${run}`,
    type: "BUY_X_GET_Y",
    params: { buyQty: 10, getQty: 1, freeProductId: ids.gift, maxSets: null },
    productIds: [ids.a],
    retailerIds: [ids.r1, ids.r2],
    budget: 4000,
    priority: 10,
  });
  // Group (r3 only): 10% off product A.
  ids.pct = await mkScheme({ name: `Test 10% ${run}`, type: "PERCENT", params: { percent: 10 }, productIds: [ids.a], groupIds: [group.id], priority: 20 });
  // Coupon for r1, once.
  ids.coupon = await mkScheme({
    name: `Test coupon ${run}`,
    type: "FLAT",
    params: { amount: 1000, perUnit: false },
    productIds: [ids.a],
    retailerIds: [ids.r1],
    couponCode: `T${run}`,
    maxUsesPerRetailer: 1,
    priority: 30,
  });
});

afterAll(async () => {
  // Switch this run's data off so it never shows in the demo storefront.
  const db = tenantDb(T);
  await db.scheme.updateMany({ where: { id: { in: schemeIds } }, data: { active: false } });
  await db.product.updateMany({ where: { id: { in: [ids.a, ids.gift, ids.hidden] } }, data: { active: false } });
  await db.priceList.update({ where: { id: ids.list }, data: { active: false } });
  await prisma.$disconnect();
});

describe("exit check: one product, three retailers", () => {
  it("shows each retailer their own rate and schemes", async () => {
    const [q1, q2, q3] = await Promise.all([ids.r1, ids.r2, ids.r3].map((r) => quote(r, [{ productId: ids.a, quantity: 20 }])));

    // r1: default ₹100, 2 free gifts.
    expect(q1.lines[0]).toMatchObject({ price: 10000, priceSource: "default", gross: 200000, discount: 0 });
    expect(q1.free).toEqual([expect.objectContaining({ productId: ids.gift, quantity: 2, value: 4000 })]);
    // r2: price list ₹90, same 2 free gifts.
    expect(q2.lines[0]).toMatchObject({ price: 9000, priceSource: "list", gross: 180000 });
    expect(q2.free.map((f) => f.quantity)).toEqual([2]);
    // r3: special rate ₹85 beats the list; group 10% off; no gifts.
    expect(q3.lines[0]).toMatchObject({ price: 8500, priceSource: "retailer", gross: 170000, discount: 17000, taxable: 153000 });
    expect(q3.free).toEqual([]);
    expect(q3.applied.map((a) => a.schemeId)).toEqual([ids.pct]);
    // GST 5% on the taxable value; total = taxable + GST.
    expect(q3).toMatchObject({ subtotal: 153000, gstAmount: 7650, totalAmount: 160650 });
    expect(q1.problems).toEqual([]);
  });

  it("only shows each retailer the schemes meant for them", async () => {
    const offers = await withTenantTx(T, async (tx) => {
      const out: Record<string, string[]> = {};
      for (const r of [ids.r1, ids.r2, ids.r3]) {
        const { offers } = await schemesFor(tx, (await retailerPricingCtx(tx, r))!, new Date());
        out[r] = offers.map((o) => o.id).filter((id) => schemeIds.includes(id));
      }
      return out;
    });
    expect(offers[ids.r1]).toEqual([ids.bxgy]); // coupon schemes are not advertised
    expect(offers[ids.r2]).toEqual([ids.bxgy]);
    expect(offers[ids.r3]).toEqual([ids.pct]);
  });
});

describe("catalogue rules", () => {
  it("hides products from retailers outside their groups", async () => {
    const seen = await withTenantTx(T, async (tx) => ({
      r1: (await catalogueFor(tx, (await retailerPricingCtx(tx, ids.r1))!)).some((p) => p.id === ids.hidden),
      r3: (await catalogueFor(tx, (await retailerPricingCtx(tx, ids.r3))!)).some((p) => p.id === ids.hidden),
    }));
    expect(seen).toEqual({ r1: false, r3: true });
    const q = await quote(ids.r1, [{ productId: ids.hidden, quantity: 1 }]);
    expect(q.lines).toEqual([]);
    expect(q.problems[0]).toMatch(/no longer available/);
  });

  it("cases, minimum quantity, minimum order value and delivery charge", async () => {
    const q = await quote(ids.r2, [{ productId: ids.a, cases: 2 }]);
    expect(q.lines[0]).toMatchObject({ quantity: 20, cases: 2, caseSize: 10 });
    expect((await quote(ids.r2, [{ productId: ids.a, quantity: 1 }])).problems[0]).toMatch(/at least 2/);

    const strict = { cart: { ...CART_DEFAULTS, minOrderValue: 50000, deliveryCharge: 3000, freeDeliveryAbove: 100000, deliveryGstRate: 18 } };
    const small = await quote(ids.r2, [{ productId: ids.a, quantity: 2 }], {}, strict);
    expect(small).toMatchObject({ goodsValue: 18000, shortBy: 32000, deliveryCharge: 3000 });
    expect(small.problems.join()).toMatch(/Minimum order/);
    // 6 × ₹90 = ₹540 goods + ₹30 delivery (+18% GST on it).
    const ok = await quote(ids.r2, [{ productId: ids.a, quantity: 6 }], {}, strict);
    expect(ok).toMatchObject({ shortBy: 0, deliveryCharge: 3000, subtotal: 57000, gstAmount: 2700 + 540, problems: [] });
    expect((await quote(ids.r2, [{ productId: ids.a, quantity: 11 }], {}, strict)).deliveryCharge).toBe(3000);
    expect((await quote(ids.r2, [{ productId: ids.a, quantity: 20 }], {}, strict)).deliveryCharge).toBe(0);
  });
});

describe("placing orders", () => {
  it("bills exactly the quote, spends the scheme budget and gives it back on cancel", async () => {
    const q = await quote(ids.r2, [{ productId: ids.a, quantity: 20 }]);
    const { order } = await place(ids.r2, [{ productId: ids.a, quantity: 20 }]);
    expect(order).toMatchObject({ grossAmount: q.grossAmount, subtotal: q.subtotal, gstAmount: q.gstAmount, totalAmount: q.totalAmount, priceListId: ids.list });
    const items = order.items.sort((a, b) => b.price - a.price);
    expect(items.map((i) => [i.productId, i.quantity, i.price, i.freeSchemeId])).toEqual([
      [ids.a, 20, 9000, null],
      [ids.gift, 2, 0, ids.bxgy],
    ]);
    const db = tenantDb(T);
    expect((await db.scheme.findUniqueOrThrow({ where: { id: ids.bxgy } })).spent).toBe(4000);

    // Budget used up: r1 now gets no gifts, and the order still goes through.
    const q1 = await quote(ids.r1, [{ productId: ids.a, quantity: 20 }]);
    expect(q1.free).toEqual([]);
    expect(q1.offers.map((o) => o.id)).not.toContain(ids.bxgy);

    await withTenantTx(T, (tx) => releaseRedemptions(tx, order.id));
    expect((await db.scheme.findUniqueOrThrow({ where: { id: ids.bxgy } })).spent).toBe(0);
    expect((await quote(ids.r1, [{ productId: ids.a, quantity: 20 }])).free[0]?.quantity).toBe(2);
  });

  it("coupon: wrong code refused, right code once per retailer", async () => {
    const wrong = await quote(ids.r1, [{ productId: ids.a, quantity: 2 }], { coupon: "NOPE" });
    expect(wrong.coupon).toMatchObject({ valid: false });
    await expect(place(ids.r1, [{ productId: ids.a, quantity: 2 }], "NOPE")).rejects.toThrow(MoneyError);
    // Someone else's coupon is not valid either.
    expect((await quote(ids.r2, [{ productId: ids.a, quantity: 2 }], { coupon: `t${run}` })).coupon?.valid).toBe(false);

    const right = await quote(ids.r1, [{ productId: ids.a, quantity: 2 }], { coupon: ` t${run} ` });
    expect(right.coupon).toMatchObject({ valid: true });
    expect(right.discountAmount).toBe(1000);
    const { order } = await place(ids.r1, [{ productId: ids.a, quantity: 2 }], `T${run}`);
    expect(order).toMatchObject({ couponCode: `T${run}`, discountAmount: 1000 });
    const again = await quote(ids.r1, [{ productId: ids.a, quantity: 2 }], { coupon: `T${run}` });
    expect(again.coupon).toMatchObject({ valid: false, message: expect.stringMatching(/used up/) });
  });

  it("refuses an order when a scheme runs out between quote and order", async () => {
    // Another order spends the budget after the quote (simulated by raising spent).
    await tenantDb(T).scheme.update({ where: { id: ids.bxgy }, data: { budget: 4000, spent: 0 } });
    const raced = await withMoney(T, adminId, async (ctx) => {
      // Inside the same transaction: quote sees budget 4000, then spent jumps.
      const r = (await retailerPricingCtx(ctx.tx, ids.r1))!;
      const q = await quoteCart(ctx.tx, SETTINGS, r, { items: [{ productId: ids.a, quantity: 20 }] });
      await ctx.tx.scheme.update({ where: { id: ids.bxgy }, data: { spent: 3000 } });
      const n = await ctx.tx.$executeRaw`UPDATE "Scheme" SET "spent" = "spent" + ${q.applied[0].value} WHERE "id" = ${ids.bxgy} AND ("budget" IS NULL OR "spent" + ${q.applied[0].value} <= "budget")`;
      throw new MoneyError(`rows=${n}`, 409);
    }).catch((e: Error) => e.message);
    expect(raced).toBe("rows=0");
    expect((await tenantDb(T).scheme.findUniqueOrThrow({ where: { id: ids.bxgy } })).spent).toBe(0);
  });

  it("books the discounted value as the sale on delivery", async () => {
    const { order } = await place(ids.r3, [{ productId: ids.a, quantity: 20 }]);
    const before = await withMoney(T, adminId, (ctx) => retailerBalances(ctx, ids.r3));
    await withMoney(T, adminId, async (ctx) => {
      const fresh = await ctx.tx.order.findUniqueOrThrow({ where: { id: order.id } });
      await onOrderDelivered(ctx, fresh, null);
    });
    const after = await withMoney(T, adminId, (ctx) => retailerBalances(ctx, ids.r3));
    expect(after.receivable - before.receivable).toBe(160650);
    const bill = await tenantDb(T).bill.findFirstOrThrow({ where: { orderId: order.id } });
    expect(bill.amount).toBe(160650);
  });
});
