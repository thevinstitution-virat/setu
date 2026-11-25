/**
 * Deeper credit control, against the real database: a limit on unpaid bills,
 * a temporary limit until a day, a hold after a bounced cheque, post-dated
 * cheques counted against exposure when the business chooses, and the check
 * done again when an order leaves (a failed check leaves the order on hold
 * even though the dispatch itself is undone).
 *
 * Everything is created fresh in the demo tenant; settings are restored.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { chequeAction, onOrderDispatched, recheckCreditAtDispatch, recordPayment, withMoney } from "@/lib/ledger";
import { dispatchOrder } from "@/lib/delivery";
import { placeOrder } from "@/lib/order-place";
import { khataSummary } from "@/lib/khata";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { MONEY_DEFAULTS, termsFor } from "@/lib/money-settings";

let T = "";
let adminId = "";
let areaId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { tea: "", cat: "" };
const DAY = 24 * 60 * 60 * 1000;

async function setMoney(over: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(t.settings as object),
        cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
        invoice: { ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt: "dispatch" },
        money: { ...MONEY_DEFAULTS, holdOnOverdue: false, ...over },
      } as object,
    },
  });
}

async function newShop(extra: Record<string, unknown> = {}) {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Credit test ${run}-${n}`,
      phone: `1${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Credit test ${run}-${n}`, shopNumber: "7", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null, ...extra } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}
/** Place an order of `quantity` × ₹105 (₹100 + 5%). */
const place = (retailerId: string, quantity = 1) =>
  withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId, placedById: adminId, items: [{ productId: ids.tea, quantity }] })).then((r) => r.order);
const dispatch = (orderId: string) => withMoney(T, adminId, (ctx) => onOrderDispatched(ctx, orderId));
const orderRow = (id: string) => tenantDb(T).order.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  ids.cat = (await db.category.create({ data: { name: `Credit cat ${run}` } })).id;
  ids.tea = (await db.product.create({ data: { name: `Test CRD ${run}`, sku: `CRD-TEA-${run}`, categoryId: ids.cat, unit: "pc", price: 10000, mrp: 20000, gstRate: 5, hsnCode: "0902" } })).id;
  await setMoney({});
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).product.updateMany({ where: { id: ids.tea }, data: { active: false } });
  }
});

describe("credit terms", () => {
  const base = { paymentMode: null, creditLimit: 100000, creditDays: null };
  const now = new Date("2026-11-25T06:00:00Z");
  it("a temporary limit is used until its last day, and only when higher", () => {
    expect(termsFor(MONEY_DEFAULTS, base, now)).toMatchObject({ creditLimit: 100000, creditBills: null, tempLimit: null });
    const until = new Date("2026-11-30T18:29:59.999Z");
    expect(termsFor(MONEY_DEFAULTS, { ...base, tempCreditLimit: 500000, tempCreditUntil: until }, now)).toMatchObject({ creditLimit: 500000, tempLimit: { amount: 500000, until } });
    // Over: back to the usual limit.
    expect(termsFor(MONEY_DEFAULTS, { ...base, tempCreditLimit: 500000, tempCreditUntil: until }, new Date("2026-12-01T00:00:00Z"))).toMatchObject({ creditLimit: 100000, tempLimit: null });
    // Never lowers a limit, and no limit stays no limit.
    expect(termsFor(MONEY_DEFAULTS, { ...base, tempCreditLimit: 50000, tempCreditUntil: until }, now).creditLimit).toBe(100000);
    expect(termsFor(MONEY_DEFAULTS, { ...base, creditLimit: null, tempCreditLimit: 50000, tempCreditUntil: until }, now).creditLimit).toBeNull();
  });
  it("the bills limit comes from the retailer, else the business", () => {
    expect(termsFor({ ...MONEY_DEFAULTS, defaultCreditBills: 4 }, base).creditBills).toBe(4);
    expect(termsFor({ ...MONEY_DEFAULTS, defaultCreditBills: 4 }, { ...base, creditBills: 2 }).creditBills).toBe(2);
  });
});

describe("holds when an order is placed", () => {
  it("holds a retailer who already has the allowed number of unpaid bills", async () => {
    await setMoney({});
    const shop = await newShop({ creditBills: 2 });
    for (let i = 0; i < 2; i++) {
      const o = await place(shop);
      expect(o.creditHold).toBe(false);
      await dispatch(o.id);
    }
    const third = await place(shop);
    expect([third.creditHold, third.creditHoldReason]).toEqual([true, "2 unpaid bills (limit 2)"]);
  });

  it("a temporary limit lets a bigger order through, and shows on the khata", async () => {
    await setMoney({});
    const shop = await newShop({ creditLimit: 20000 });
    const held = await place(shop, 3); // ₹315 against a ₹200 limit
    expect(held.creditHold).toBe(true);
    await tenantDb(T).retailerProfile.update({ where: { id: shop }, data: { tempCreditLimit: 100000, tempCreditUntil: new Date(Date.now() + 3 * DAY) } });
    const fine = await place(shop, 3); // ₹315 + ₹315 open ≤ ₹1,000
    expect(fine.creditHold).toBe(false);
    const khata = await withMoney(T, null, (ctx) => khataSummary(ctx, shop));
    expect(khata.terms.creditLimit).toBe(100000);
    expect(khata.terms.tempLimit?.amount).toBe(100000);
    expect(khata.termsOverride).toMatchObject({ creditLimit: 20000, tempCreditLimit: 100000 });
  });

  it("holds after a bounced cheque when the business asks for it", async () => {
    await setMoney({ holdOnBounce: true, bounceHoldDays: 30 });
    const shop = await newShop();
    const first = await place(shop);
    await dispatch(first.id);
    const pay = await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: shop, amount: 10500, method: "CHEQUE", cheque: { number: `B${run}`, bank: "Test Bank", date: new Date() }, atOffice: true }));
    await withMoney(T, adminId, (ctx) => chequeAction(ctx, pay.cheque!.id, "deposit"));
    await withMoney(T, adminId, (ctx) => chequeAction(ctx, pay.cheque!.id, "bounce", "Insufficient funds"));
    const next = await place(shop);
    expect(next.creditHold).toBe(true);
    expect(next.creditHoldReason).toMatch(new RegExp(`^Cheque B${run} bounced on \\d{4}-\\d{2}-\\d{2}$`));
    // Switched off: the same shop orders freely.
    await setMoney({ holdOnBounce: false });
    expect((await place(shop)).creditHold).toBe(false);
  });

  it("counts held post-dated cheques against exposure only when chosen", async () => {
    await setMoney({});
    const shop = await newShop({ creditLimit: 30000 });
    const first = await place(shop, 2); // ₹210
    await dispatch(first.id);
    // A post-dated cheque for the bill: held, so the ₹210 is still owed.
    await withMoney(T, adminId, (ctx) =>
      recordPayment(ctx, { retailerId: shop, amount: 21000, method: "CHEQUE", cheque: { number: `P${run}`, bank: "Test Bank", date: new Date(Date.now() + 7 * DAY) }, atOffice: true })
    );
    expect((await place(shop, 2)).creditHold).toBe(true); // ₹210 + ₹210 > ₹300
    await setMoney({ pdcReducesExposure: true });
    // The held order above still counts as open (₹210): ₹210 owed + ₹210 open + ₹105 − ₹210 held = ₹315 > ₹300.
    expect((await place(shop, 1)).creditHold).toBe(true);
    const other = await newShop({ creditLimit: 30000 });
    const o = await place(other, 2);
    await dispatch(o.id);
    await withMoney(T, adminId, (ctx) =>
      recordPayment(ctx, { retailerId: other, amount: 21000, method: "CHEQUE", cheque: { number: `Q${run}`, bank: "Test Bank", date: new Date(Date.now() + 7 * DAY) }, atOffice: true })
    );
    expect((await place(other, 2)).creditHold).toBe(false); // ₹210 owed + ₹210 − ₹210 held ≤ ₹300
  });
});

describe("the check when an order leaves", () => {
  it("is off unless the business turns it on", async () => {
    await setMoney({});
    const shop = await newShop({ creditLimit: 100000 });
    const o = await place(shop);
    await tenantDb(T).retailerProfile.update({ where: { id: shop }, data: { creditLimit: 0 } });
    await withMoney(T, adminId, (ctx) => recheckCreditAtDispatch(ctx, o.id));
    expect((await orderRow(o.id)).creditHold).toBe(false);
  });

  it("refuses the dispatch, undoes it, and leaves the order on hold for approval", async () => {
    await setMoney({ checkCreditAtBilling: true });
    const shop = await newShop({ creditLimit: 100000 });
    const o = await place(shop);
    expect(o.creditHold).toBe(false);
    // The limit is cut after the order was placed.
    await tenantDb(T).retailerProfile.update({ where: { id: shop }, data: { creditLimit: 5000 } });
    await expect(withMoney(T, adminId, (ctx) => dispatchOrder(ctx, o.id))).rejects.toThrow(/is on credit hold: Over credit limit by ₹55\.00/);
    const held = await orderRow(o.id);
    // Nothing of the dispatch stayed: not out for delivery, no invoice; but the hold did.
    expect([held.status, held.creditHold, held.creditHoldReason]).toEqual(["PLACED", true, "Over credit limit by ₹55.00 (limit ₹50.00)"]);
    expect(await tenantDb(T).invoice.count({ where: { orderId: o.id } })).toBe(0);

    // Approved by someone with credit rights: it goes, and isn't checked again.
    await tenantDb(T).order.update({ where: { id: o.id }, data: { creditApprovedBy: adminId, creditApprovedAt: new Date() } });
    await withMoney(T, adminId, (ctx) => dispatchOrder(ctx, o.id));
    expect((await orderRow(o.id)).status).toBe("OUT_FOR_DELIVERY");
    expect(await tenantDb(T).invoice.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("lets a good order through and skips prepaid retailers", async () => {
    await setMoney({ checkCreditAtBilling: true });
    const shop = await newShop({ creditLimit: 100000 });
    const o = await place(shop);
    await withMoney(T, adminId, (ctx) => dispatchOrder(ctx, o.id));
    expect((await orderRow(o.id)).status).toBe("OUT_FOR_DELIVERY");
    const prepaid = await newShop({ paymentMode: "PREPAID", creditLimit: 0 });
    await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: prepaid, amount: 50000, method: "CASH", purpose: "WALLET", atOffice: true }));
    const p = await place(prepaid);
    await withMoney(T, adminId, (ctx) => dispatchOrder(ctx, p.id));
    expect((await orderRow(p.id)).creditHold).toBe(false);
  });
});
