/**
 * Post-dated cheques, against the real database: a cheque dated after the day
 * it is received is held (no ledger entry, no bill paid, dues unchanged) until
 * it is banked on or after its date; it can be handed back before that. A
 * cheque dated today or earlier counts at once, as before.
 *
 * Everything is created fresh in the demo tenant; settings are restored.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, chequeAction, isPostDated, onOrderDispatched, recordPayment, reversePayment, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { khataSummary } from "@/lib/khata";
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
const days = (k: number) => new Date(Date.now() + k * DAY);

async function newShopWithBill() {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Cheque test ${run}-${n}`,
      phone: `3${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Cheque test ${run}-${n}`, shopNumber: "7", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null } },
    },
    include: { retailerProfile: true },
  });
  const shop = u.retailerProfile!.id;
  // One bill of ₹1,050: 10 × ₹100 at 5%.
  const order = await withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId: shop, placedById: adminId, items: [{ productId: ids.tea, quantity: 10 }] })).then((r) => r.order);
  await withMoney(T, adminId, (ctx) => onOrderDispatched(ctx, order.id));
  return shop;
}
const receivable = (retailerId: string) => withMoney(T, null, (ctx) => balanceOf(ctx, { type: "RECEIVABLE", retailerId }));
const billOf = (retailerId: string) => tenantDb(T).bill.findFirstOrThrow({ where: { retailerId } });
const cheque = (retailerId: string, date: Date, occurredAt?: Date) =>
  withMoney(T, adminId, (ctx) =>
    recordPayment(ctx, { retailerId, amount: 105000, method: "CHEQUE", cheque: { number: `${run}${n}`, bank: "Test Bank", date }, atOffice: true, occurredAt })
  );
const entriesOf = (paymentId: string) => tenantDb(T).journalEntry.count({ where: { paymentId } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  ids.cat = (await db.category.create({ data: { name: `Cheque cat ${run}` } })).id;
  ids.tea = (await db.product.create({ data: { name: `Test PDC ${run}`, sku: `PDC-TEA-${run}`, categoryId: ids.cat, unit: "pc", price: 10000, mrp: 20000, gstRate: 5, hsnCode: "0902" } })).id;
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

describe("post-dated cheques", () => {
  it("knows a post-dated cheque by the day in India, not the hour", () => {
    const on = new Date("2026-11-25T10:00:00+05:30");
    expect(isPostDated(new Date("2026-11-25T00:00:00Z"), on)).toBe(false);
    expect(isPostDated(new Date("2026-11-25T18:29:00Z"), on)).toBe(false); // 23:59 IST the same day
    expect(isPostDated(new Date("2026-11-26T00:00:00Z"), on)).toBe(true);
  });

  it("a cheque dated today counts at once, as before", async () => {
    const shop = await newShopWithBill();
    expect(await receivable(shop)).toBe(105000);
    const pay = await cheque(shop, new Date());
    expect(pay.state).toBe("CONFIRMED");
    expect(await receivable(shop)).toBe(0);
    expect((await billOf(shop)).settled).toBe(true);
  });

  it("a cheque dated later is held: nothing posted, the bill stays due", async () => {
    const shop = await newShopWithBill();
    const pay = await cheque(shop, days(5));
    expect([pay.state, pay.entryId, pay.allocated]).toEqual(["POST_DATED", null, 0]);
    expect(pay.cheque?.status).toBe("RECEIVED");
    expect(await entriesOf(pay.id)).toBe(0);
    expect(await receivable(shop)).toBe(105000);
    const bill = await billOf(shop);
    expect([bill.paid, bill.settled]).toEqual([0, false]);
    const khata = await withMoney(T, null, (ctx) => khataSummary(ctx, shop));
    expect(khata.postDated).toEqual({ amount: 105000, count: 1 });

    // It can't go to the bank before its date.
    await expect(withMoney(T, adminId, (ctx) => chequeAction(ctx, pay.cheque!.id, "deposit"))).rejects.toThrow(/can be banked from that day/);
    // Nor be cleared or bounced while held.
    await expect(withMoney(T, adminId, (ctx) => chequeAction(ctx, pay.cheque!.id, "clear"))).rejects.toThrow(/not active/);

    // Handed back: closed without ever touching the books.
    await withMoney(T, adminId, (ctx) => reversePayment(ctx, pay.id, "Cheque given back"));
    const after = await tenantDb(T).payment.findUniqueOrThrow({ where: { id: pay.id } });
    expect([after.state, after.rejectReason, after.entryId]).toEqual(["REVERSED", "Cheque given back", null]);
    expect(await entriesOf(pay.id)).toBe(0);
    expect(await receivable(shop)).toBe(105000);
    expect((await withMoney(T, null, (ctx) => khataSummary(ctx, shop))).postDated).toEqual({ amount: 0, count: 0 });
  });

  it("banking a held cheque on or after its date books the receipt that day", async () => {
    const shop = await newShopWithBill();
    // Received ten days ago, dated five days ago: held when it came in, bankable today.
    const pay = await cheque(shop, days(-5), days(-10));
    expect(pay.state).toBe("POST_DATED");
    expect(await receivable(shop)).toBe(105000);

    const before = Date.now();
    await withMoney(T, adminId, (ctx) => chequeAction(ctx, pay.cheque!.id, "deposit"));
    const banked = await tenantDb(T).payment.findUniqueOrThrow({ where: { id: pay.id }, include: { cheque: true } });
    expect([banked.state, banked.allocated, banked.cheque?.status]).toEqual(["CONFIRMED", 105000, "DEPOSITED"]);
    // The receipt is dated the banking day, so as-on reports don't count it earlier.
    expect(banked.collectedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const entry = await tenantDb(T).journalEntry.findUniqueOrThrow({ where: { id: banked.entryId! }, include: { lines: { include: { account: { select: { code: true } } } } } });
    expect(entry.kind).toBe("PAYMENT");
    expect(entry.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(entry.lines.map((l) => [l.account.code.split(":")[0], l.amount]).sort()).toEqual([["CHEQUES_IN_HAND", 105000], ["RECEIVABLE", -105000]]);
    expect(await receivable(shop)).toBe(0);
    expect((await billOf(shop)).settled).toBe(true);

    // From here it is an ordinary cheque.
    await withMoney(T, adminId, (ctx) => chequeAction(ctx, pay.cheque!.id, "clear"));
    expect((await tenantDb(T).cheque.findUniqueOrThrow({ where: { id: pay.cheque!.id } })).status).toBe("CLEARED");
  });

  it("leaves the books check clean", async () => {
    const res = await withMoney(T, null, (ctx) => checkBooks(ctx));
    const failed = res.results.filter((c) => !c.ok && ["balanced", "trial", "bills", "settled", "payments", "unconfirmed", "shops"].includes(c.key));
    expect(failed).toEqual([]);
  });
});
