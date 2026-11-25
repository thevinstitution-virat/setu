/**
 * Receipts kept on account until tagged, and post-dated cheques that can be
 * banked today (the list and the morning reminder), against the real
 * database. Everything is created fresh in the demo tenant; settings are
 * restored.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { allocateRetailer, onOrderDispatched, recordPayment, tagPayment, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { khataSummary } from "@/lib/khata";
import { bankTodayWhere, remindChequesDue } from "@/lib/cheques-due";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { MONEY_DEFAULTS } from "@/lib/money-settings";
import { istDay } from "@/lib/field-math";

let T = "";
let adminId = "";
let areaId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { tea: "", cat: "" };
const DAY = 24 * 60 * 60 * 1000;

/** A shop with three bills of ₹105, ₹210 and ₹315, oldest first. */
async function newShop(onAccount: boolean) {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `On account ${run}-${n}`,
      phone: `3${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `On account ${run}-${n}`, shopNumber: "7", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null, receiptsOnAccount: onAccount } },
    },
    include: { retailerProfile: true },
  });
  const shop = u.retailerProfile!.id;
  for (const quantity of [1, 2, 3]) {
    const order = await withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId: shop, placedById: adminId, items: [{ productId: ids.tea, quantity }] })).then((r) => r.order);
    await withMoney(T, adminId, (ctx) => onOrderDispatched(ctx, order.id));
  }
  const bills = await tenantDb(T).bill.findMany({ where: { retailerId: shop }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] });
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
  ids.cat = (await db.category.create({ data: { name: `On account cat ${run}` } })).id;
  ids.tea = (await db.product.create({ data: { name: `Test ONACC ${run}`, sku: `ONACC-TEA-${run}`, categoryId: ids.cat, unit: "pc", price: 10000, mrp: 20000, gstRate: 5, hsnCode: "0902" } })).id;
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(demo.settings as object),
        cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
        invoice: { ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt: "dispatch" },
        money: { ...MONEY_DEFAULTS, holdOnOverdue: false },
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

describe("receipts kept on account", () => {
  it("a receipt with no bills waits on account; tagging pays the bill", async () => {
    const { shop, bills } = await newShop(true);
    const pay = await cash(shop, 20000);
    expect(await paid(shop)).toEqual([0, 0, 0]);
    const k = await withMoney(T, adminId, (ctx) => khataSummary(ctx, shop));
    expect(k.advance).toBe(20000);
    expect(k.termsOverride.receiptsOnAccount).toBe(true);
    await withMoney(T, adminId, (ctx) => tagPayment(ctx, pay.id, [bills[1]]));
    expect(await paid(shop)).toEqual([0, 20000, 0]);
  });

  it("pays only the chosen bills; what is left waits instead of going to the oldest", async () => {
    const { shop, bills } = await newShop(true);
    await cash(shop, 40000, [bills[2]]);
    expect(await paid(shop)).toEqual([0, 0, 31500]);
    expect((await withMoney(T, adminId, (ctx) => khataSummary(ctx, shop))).advance).toBe(8500);
    // Switched off: what waits goes to the oldest bill.
    await tenantDb(T).retailerProfile.update({ where: { id: shop }, data: { receiptsOnAccount: false } });
    await withMoney(T, adminId, (ctx) => allocateRetailer(ctx, shop));
    expect(await paid(shop)).toEqual([8500, 0, 31500]);
  });

  it("other shops still pay oldest first", async () => {
    const { shop } = await newShop(false);
    await cash(shop, 20000);
    expect(await paid(shop)).toEqual([10500, 9500, 0]);
  });
});

describe("post-dated cheques to bank today", () => {
  it("lists a held cheque from its date and reminds whoever handles cheques once", async () => {
    const { shop } = await newShop(false);
    // A day of its own per run: the reminder goes once a day, so an earlier run's day would be used up.
    const date = new Date(Date.now() + (30 + (Number(run) % 3000)) * DAY);
    const pay = await withMoney(T, adminId, (ctx) =>
      recordPayment(ctx, { retailerId: shop, amount: 10500, method: "CHEQUE", cheque: { number: `OA${run}`, bank: "Test Bank", date }, atOffice: true })
    );
    expect(pay.state).toBe("POST_DATED");
    const db = tenantDb(T);
    const mine = (now: Date, heldOnly = true) => db.cheque.count({ where: { ...bankTodayWhere(now, { heldOnly }), paymentId: pay.id } });
    expect(await mine(new Date())).toBe(0);
    const onTheDay = new Date(date.getTime() + 60_000);
    expect(await mine(onTheDay)).toBe(1);
    expect(await mine(new Date(date.getTime() + 5 * DAY), false)).toBe(1);
    expect(await mine(new Date(date.getTime() - DAY))).toBe(0);

    const sent = await withMoney(T, null, (ctx) => remindChequesDue(ctx.tx, T, onTheDay));
    expect(sent).toBeGreaterThanOrEqual(1);
    const notes = await db.notification.findMany({ where: { userId: adminId, event: "staff.cheques_due", dedupeKey: { startsWith: `cheques_due:${istDay(onTheDay)}` } } });
    expect(notes.length).toBe(1);
    expect(notes[0].title).toMatch(/post-dated cheques can be banked today/);
    // Oldest first, five named: this run's cheque is among them unless older test cheques fill the five.
    expect(notes[0].body).toMatch(/#/);
    // Once a day: a second run that day sends nothing more.
    await withMoney(T, null, (ctx) => remindChequesDue(ctx.tx, T, onTheDay));
    expect(await db.notification.count({ where: { userId: adminId, event: "staff.cheques_due", dedupeKey: { startsWith: `cheques_due:${istDay(onTheDay)}` } } })).toBe(1);

    // Switched off: no reminder.
    const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
    const s = t.settings as Record<string, unknown>;
    await prisma.tenant.update({ where: { id: T }, data: { settings: { ...s, money: { ...(s.money as object), chequeReminder: false } } as object } });
    expect(await withMoney(T, null, (ctx) => remindChequesDue(ctx.tx, T, onTheDay))).toBe(0);
  });
});
