/**
 * Rupee round-off on sales bills, against the real database: the order and its
 * invoice carry the paise added or taken off, the ledger posts them to the
 * Rounding off account, credit notes are rounded the same way and a note that
 * takes everything left gives the invoice's own round-off back, so the bill
 * nets to zero. With the setting off, totals stay exact to the paisa.
 *
 * Everything is created fresh in the demo tenant; settings are restored.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, issueCreditNote, issueDebitNote, onOrderDispatched, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { roundRupee } from "@/lib/money";
import { repriceOrder } from "@/lib/delivery-math";
import { tallyXml, type ExportDoc } from "@/lib/gst-exports";
import { checkBooks } from "@/lib/books";
import type { CartItemInput } from "@/lib/pricing";

let T = "";
let adminId = "";
let areaId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { odd: "", cat: "" };

async function setInvoice(over: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(t.settings as object),
        cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 3000, freeDeliveryAbove: 100_000_00, deliveryGstRate: 18, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
        invoice: { ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt: "dispatch", ...over },
      } as object,
    },
  });
}

async function newRetailer() {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Round test ${run}-${n}`,
      phone: `4${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Round test ${run}-${n}`, shopNumber: "7", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

const place = (retailerId: string, items: CartItemInput[]) =>
  withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId, placedById: adminId, items })).then((r) => r.order);
const dispatch = (orderId: string) => withMoney(T, adminId, (ctx) => onOrderDispatched(ctx, orderId));
const invoiceOf = (orderId: string) =>
  tenantDb(T).invoice.findFirstOrThrow({ where: { orderId, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } }, include: { lines: { orderBy: { sl: "asc" } } } });
const receivable = (retailerId: string) => withMoney(T, null, (ctx) => balanceOf(ctx, { type: "RECEIVABLE", retailerId }));
/** The Rounding off line of a document's ledger entry (0 when it has none). */
async function roundLine(entryId: string | null) {
  const lines = await tenantDb(T).ledgerLine.findMany({ where: { entryId: entryId! }, include: { account: { select: { code: true } } } });
  expect(lines.reduce((a, l) => a + l.amount, 0)).toBe(0);
  return lines.find((l) => l.account.code === "ROUND_OFF")?.amount ?? 0;
}

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  ids.cat = (await db.category.create({ data: { name: `Round cat ${run}` } })).id;
  // ₹33.37 at 5%: one piece = ₹35.04 with GST; with the ₹30 + 18% delivery charge the bill is ₹70.44.
  ids.odd = (await db.product.create({ data: { name: `Test ODD ${run}`, sku: `RND-ODD-${run}`, categoryId: ids.cat, unit: "pc", price: 3337, mrp: 6000, gstRate: 5, hsnCode: "0902" } })).id;
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).product.updateMany({ where: { id: ids.odd }, data: { active: false } });
  }
});

describe("round-off maths", () => {
  it("rounds to the rupee, 50 paise and above going up", () => {
    expect(roundRupee(123450)).toEqual({ roundOff: 50, total: 123500 });
    expect(roundRupee(123449)).toEqual({ roundOff: -49, total: 123400 });
    expect(roundRupee(123400)).toEqual({ roundOff: 0, total: 123400 });
    expect(roundRupee(49)).toEqual({ roundOff: -49, total: 0 });
    expect(roundRupee(0)).toEqual({ roundOff: 0, total: 0 });
  });

  it("re-prices a cut order with the order's own rounding choice", () => {
    const item = { id: "a", quantity: 3, price: 3337, gstRate: 5, discount: 0, freeSchemeId: null, orderedQty: null, cases: null, caseSize: null };
    const exact = repriceOrder({ deliveryCharge: 3000, deliveryGstRate: 18 }, [{ item, delivered: 1 }]);
    expect([exact.roundOff, exact.totalAmount]).toEqual([0, 7044]);
    const rounded = repriceOrder({ deliveryCharge: 3000, deliveryGstRate: 18, roundTotal: true }, [{ item, delivered: 1 }]);
    expect([rounded.subtotal + rounded.gstAmount, rounded.roundOff, rounded.totalAmount]).toEqual([7044, -44, 7000]);
  });
});

describe("with the setting off", () => {
  it("bills stay exact to the paisa", async () => {
    await setInvoice({ roundOff: "none" });
    const r = await newRetailer();
    const order = await place(r, [{ productId: ids.odd, quantity: 1 }]);
    expect([order.roundTotal, order.roundOff, order.totalAmount]).toEqual([false, 0, 7044]);
    await dispatch(order.id);
    const doc = await invoiceOf(order.id);
    expect([doc.roundOff, doc.total]).toEqual([0, 7044]);
    expect(await roundLine(doc.entryId)).toBe(0);
  });
});

describe("with bills rounded to the rupee", () => {
  let down = "";
  let up = "";
  let shop = "";

  beforeAll(async () => {
    await setInvoice({ roundOff: "rupee" });
    shop = await newRetailer();
  });

  it("rounds an order down and posts the paise to Rounding off", async () => {
    const order = await place(shop, [{ productId: ids.odd, quantity: 1 }]);
    down = order.id;
    expect(order.roundTotal).toBe(true);
    expect([order.subtotal + order.gstAmount, order.roundOff, order.totalAmount]).toEqual([7044, -44, 7000]);
    await dispatch(order.id);
    const doc = await invoiceOf(order.id);
    expect([doc.roundOff, doc.total]).toEqual([-44, 7000]);
    expect(doc.taxable + doc.cgst + doc.sgst + doc.igst + doc.roundOff).toBe(doc.total);
    // The lines themselves are untouched: GST is still on the exact value.
    expect(doc.lines.reduce((a, l) => a + l.total, 0)).toBe(7044);
    // Rounded down = a small loss: Rounding off is debited 44 paise.
    expect(await roundLine(doc.entryId)).toBe(44);
    const bill = await tenantDb(T).bill.findFirstOrThrow({ where: { orderId: order.id } });
    expect(bill.amount).toBe(7000);
    expect(await receivable(shop)).toBe(7000);
  });

  it("rounds an order up", async () => {
    const order = await place(shop, [{ productId: ids.odd, quantity: 3 }]);
    up = order.id;
    expect([order.subtotal + order.gstAmount, order.roundOff, order.totalAmount]).toEqual([14052, 48, 14100]);
    await dispatch(order.id);
    const doc = await invoiceOf(order.id);
    expect([doc.roundOff, doc.total]).toEqual([48, 14100]);
    // Rounded up = a small gain: Rounding off is credited 48 paise.
    expect(await roundLine(doc.entryId)).toBe(-48);
    expect(await receivable(shop)).toBe(7000 + 14100);
  });

  it("rounds a part return, and the note that takes the rest brings the bill to zero", async () => {
    const doc = await invoiceOf(up);
    const goods = doc.lines.find((l) => !l.isService)!;
    // One of three pieces back: ₹33.37 + ₹1.67 GST = ₹35.04 → ₹35.00.
    const part = await withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: doc.id, kind: "return", reason: "One piece damaged", lines: [{ lineId: goods.id, quantity: 1 }] }));
    expect([part.taxable + part.cgst + part.sgst + part.igst, part.roundOff, part.total]).toEqual([3504, -4, 3500]);
    expect(await roundLine(part.entryId)).toBe(-4);
    const rest = await withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: doc.id, kind: "cancel", reason: "Order cancelled", lines: [] }));
    // Everything left as documents: ₹141.00 − ₹35.00 = ₹106.00, though the lines left add to ₹105.48.
    expect([rest.taxable + rest.cgst + rest.sgst + rest.igst, rest.roundOff, rest.total]).toEqual([10548, 52, 10600]);
    const bill = await tenantDb(T).bill.findFirstOrThrow({ where: { orderId: up } });
    expect([bill.paid, bill.settled]).toEqual([14100, true]);
    expect(await receivable(shop)).toBe(7000);
    // The three documents' round-offs cancel out: +48 on the bill, −4 and +52 given back.
    expect(doc.roundOff - part.roundOff - rest.roundOff).toBe(0);
  });

  it("rounds a debit note", async () => {
    const doc = await invoiceOf(down);
    const goods = doc.lines.find((l) => !l.isService)!;
    // ₹10.10 more + 5% = ₹10.61 (10.605 rounds up) → ₹11.00.
    const note = await withMoney(T, adminId, (ctx) => issueDebitNote(ctx, { invoiceId: doc.id, reason: "Rate corrected", lines: [{ lineId: goods.id, amount: 1010 }] }));
    expect([note.taxable + note.cgst + note.sgst + note.igst, note.roundOff, note.total]).toEqual([1061, 39, 1100]);
    expect(await roundLine(note.entryId)).toBe(-39);
    expect(await receivable(shop)).toBe(7000 + 1100);
  });

  it("the accounting-package voucher of a rounded bill balances", async () => {
    const docs = (await tenantDb(T).invoice.findMany({
      where: { orderId: { in: [down, up] } },
      include: { lines: true, order: { select: { orderNumber: true } }, original: { select: { number: true, date: true } } },
    })) as unknown as ExportDoc[];
    expect(docs.length).toBe(5);
    const xml = tallyXml(docs, [], INVOICE_DEFAULTS.tally);
    expect(xml).toContain('<LEDGER NAME="Round Off"');
    const vouchers = xml.split("<VOUCHER ").slice(1);
    expect(vouchers.length).toBe(5);
    for (const v of vouchers) {
      // Ledger amounts only (bill allocations repeat the party amount inside its entry).
      const amounts = [...v.replace(/<BILLALLOCATIONS\.LIST>.*?<\/BILLALLOCATIONS\.LIST>/g, "").matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((m) => Math.round(Number(m[1]) * 100));
      expect(amounts.reduce((a, x) => a + x, 0)).toBe(0);
    }
  });

  it("leaves the books check clean", async () => {
    const res = await withMoney(T, null, (ctx) => checkBooks(ctx));
    const failed = res.results.filter((c) => !c.ok && ["balanced", "trial", "bills", "settled", "payments", "shops"].includes(c.key));
    expect(failed).toEqual([]);
  });
});
