/**
 * Taking a receipt against chosen bills, against the real database: the
 * chosen bills are paid first in the order chosen, anything left goes oldest
 * first; a receipt with no choice still pays oldest first; the choice can be
 * changed later; a held post-dated cheque remembers its bills until banked.
 *
 * Everything is created fresh in the demo tenant; settings are restored.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { chequeAction, onOrderDispatched, recordPayment, tagPayment, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { checkBooks } from "@/lib/books";

let T = "";
let adminId = "";
let areaId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { tea: "", cat: "" };
const DAY = 24 * 60 * 60 * 1000;

/** A shop with three bills of ₹105, ₹210 and ₹315, oldest first. */
async function newShop() {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Tag test ${run}-${n}`,
      phone: `2${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Tag test ${run}-${n}`, shopNumber: "7", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null } },
    },
    include: { retailerProfile: true },
  });
  const shop = u.retailerProfile!.id;
  for (const quantity of [1, 2, 3]) {
    const order = await withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId: shop, placedById: adminId, items: [{ productId: ids.tea, quantity }] })).then((r) => r.order);
    await withMoney(T, adminId, (ctx) => onOrderDispatched(ctx, order.id));
  }
  const bills = await tenantDb(T).bill.findMany({ where: { retailerId: shop }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
  expect(bills.map((b) => b.amount)).toEqual([10500, 21000, 31500]);
  return { shop, bills: bills.map((b) => b.id) };
}
const paid = async (shop: string) => (await tenantDb(T).bill.findMany({ where: { retailerId: shop }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] })).map((b) => b.paid);
const cash = (retailerId: string, amount: number, billIds?: string[]) =>
  withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId, amount, method: "CASH", atOffice: true, billIds }));

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  ids.cat = (await db.category.create({ data: { name: `Tag cat ${run}` } })).id;
  ids.tea = (await db.product.create({ data: { name: `Test TAG ${run}`, sku: `TAG-TEA-${run}`, categoryId: ids.cat, unit: "pc", price: 10000, mrp: 20000, gstRate: 5, hsnCode: "0902" } })).id;
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(demo.settings as object),
        cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
        invoice: { ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt: "dispatch" },
      } as object,
    },
  });
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).product.updateMany({ where: { id: ids.tea }, data: { active: false } });
  }
});

describe("receipts against chosen bills", () => {
  it("with no choice, the oldest bills are paid first (as before)", async () => {
    const { shop } = await newShop();
    await cash(shop, 20000);
    expect(await paid(shop)).toEqual([10500, 9500, 0]);
  });

  it("pays the chosen bills first, in the order chosen, then the oldest", async () => {
    const { shop, bills } = await newShop();
    // ₹400 against the third bill, then the second: 315 + 85.
    const pay = await cash(shop, 40000, [bills[2], bills[1]]);
    expect(pay.forBillIds).toEqual([bills[2], bills[1]]);
    expect(await paid(shop)).toEqual([0, 8500, 31500]);
    // More than the chosen bill needs: the rest goes oldest first.
    await cash(shop, 20000, [bills[1]]);
    expect(await paid(shop)).toEqual([7500, 21000, 31500]);
  });

  it("refuses a bill that isn't the retailer's, or is already paid", async () => {
    const a = await newShop();
    const b = await newShop();
    await expect(cash(a.shop, 10000, [b.bills[0]])).rejects.toThrow(/isn't this retailer's/);
    await cash(a.shop, 10500, [a.bills[0]]);
    await expect(cash(a.shop, 10000, [a.bills[0]])).rejects.toThrow(/already paid in full/);
    await expect(withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: a.shop, amount: 10000, method: "CASH", atOffice: true, purpose: "WALLET", billIds: [a.bills[1]] }))).rejects.toThrow(
      /Only a payment of dues/
    );
  });

  it("moves a counted receipt to other bills, and back to oldest first", async () => {
    const { shop, bills } = await newShop();
    const pay = await cash(shop, 21000);
    expect(await paid(shop)).toEqual([10500, 10500, 0]);
    const moved = await withMoney(T, adminId, (ctx) => tagPayment(ctx, pay.id, [bills[1]]));
    expect(await paid(shop)).toEqual([0, 21000, 0]);
    expect(moved.allocations.map((a) => [a.bill.id, a.amount])).toEqual([[bills[1], 21000]]);
    // The ledger didn't move: only which bills the money sits on.
    expect(await tenantDb(T).journalEntry.count({ where: { paymentId: pay.id } })).toBe(1);
    await withMoney(T, adminId, (ctx) => tagPayment(ctx, pay.id, []));
    expect(await paid(shop)).toEqual([10500, 10500, 0]);
  });

  it("a held post-dated cheque remembers its bills until it is banked", async () => {
    const { shop, bills } = await newShop();
    const pay = await withMoney(T, adminId, (ctx) =>
      recordPayment(ctx, {
        retailerId: shop,
        amount: 31500,
        method: "CHEQUE",
        cheque: { number: `T${run}`, bank: "Test Bank", date: new Date(Date.now() - 2 * DAY) },
        atOffice: true,
        occurredAt: new Date(Date.now() - 5 * DAY),
        billIds: [bills[2]],
      })
    );
    expect(pay.state).toBe("POST_DATED");
    expect(await paid(shop)).toEqual([0, 0, 0]);
    await withMoney(T, adminId, (ctx) => chequeAction(ctx, pay.cheque!.id, "deposit"));
    expect(await paid(shop)).toEqual([0, 0, 31500]);
  });

  it("leaves the books check clean", async () => {
    const res = await withMoney(T, null, (ctx) => checkBooks(ctx));
    const failed = res.results.filter((c) => !c.ok && ["balanced", "trial", "bills", "settled", "payments", "unconfirmed", "shops"].includes(c.key));
    expect(failed).toEqual([]);
  });
});
