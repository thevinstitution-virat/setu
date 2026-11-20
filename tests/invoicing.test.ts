/**
 * Phase 3 against the real database: invoices at dispatch, numbering,
 * CGST+SGST vs IGST, B2B vs B2C, bills of supply, credit / debit notes and
 * their limits, cancellation after dispatch, immutability, the ledger staying
 * in step, e-invoice (sandbox) and exports from stored documents.
 *
 * Everything is created fresh in the demo tenant (own products, retailers,
 * orders); tenant settings are restored afterwards.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import {
  balanceOf,
  creditCancelledOrder,
  issueCreditNote,
  issueDebitNote,
  onOrderCancelled,
  onOrderDelivered,
  onOrderDispatched,
  recordPayment,
  retailerBalances,
  withMoney,
} from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { khataSummary } from "@/lib/khata";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { gstinCheckDigit } from "@/lib/gst";
import { generateEInvoice, irnFor } from "@/lib/einvoice";
import { gstr1Sections, tallyXml, type ExportDoc } from "@/lib/gst-exports";
import type { CartItemInput } from "@/lib/pricing";

let T = "";
let adminId = "";
let areaId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { tea: "", soap: "", b2b: "", b2c: "", inter: "", prepaid: "", cat: "" };

const gstin = (p: string) => `${p}${gstinCheckDigit(p)}`;

async function setSettings(patch: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...(t.settings as object), ...patch } as object } });
}
const invoiceCfg = (over: Record<string, unknown> = {}) => ({
  ...INVOICE_DEFAULTS,
  city: "Mumbai",
  pinCode: "400093",
  issueAt: "dispatch",
  einvoice: { enabled: true, provider: "sandbox" },
  ...over,
});

async function newRetailer(extra: Record<string, unknown> = {}) {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Invoice test ${run}-${n}`,
      phone: `5${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: {
        create: { outletName: `Invoice test ${run}-${n}`, shopNumber: "7", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null, ...extra },
      },
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

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  ids.cat = (await db.category.create({ data: { name: `Invoice cat ${run}` } })).id;
  const mk = (sku: string, price: number, gstRate: number, hsnCode: string) =>
    db.product.create({ data: { name: `Test ${sku} ${run}`, sku: `INV-${sku}-${run}`, categoryId: ids.cat, unit: "pc", price, mrp: price * 2, gstRate, hsnCode } });
  ids.tea = (await mk("TEA", 10000, 5, "0902")).id;
  ids.soap = (await mk("SOAP", 5000, 18, "3401")).id;
  ids.b2b = await newRetailer({ gstin: gstin(`27ZZT${run.slice(0, 2)}${run.slice(2)}9Z1Z`.slice(0, 14)) });
  ids.b2c = await newRetailer();
  ids.inter = await newRetailer({ gstin: gstin(`24ZZT${run.slice(0, 2)}${run.slice(2)}8Z1Z`.slice(0, 14)), stateCode: "24" });
  ids.prepaid = await newRetailer({ paymentMode: "PREPAID" });
  await setSettings({
    cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 3000, freeDeliveryAbove: 100_000_00, deliveryGstRate: 18, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
    invoice: invoiceCfg(),
  });
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).product.updateMany({ where: { id: { in: [ids.tea, ids.soap] } }, data: { active: false } });
  }
});

describe("tax invoice at dispatch", () => {
  let orderId = "";
  it("issues a numbered B2B tax invoice with CGST + SGST that equals the order", async () => {
    const order = await place(ids.b2b, [{ productId: ids.tea, quantity: 3 }, { productId: ids.soap, quantity: 2 }]);
    orderId = order.id;
    const inv = await dispatch(order.id);
    expect(inv).toBeTruthy();
    const doc = await invoiceOf(order.id);
    expect(doc.type).toBe("TAX_INVOICE");
    expect(doc.number).toMatch(/^INV\d{4}-\d{5}$/);
    expect(doc.b2b).toBe(true);
    expect(doc.interState).toBe(false);
    expect(doc.igst).toBe(0);
    expect(doc.cgst + doc.sgst).toBe(order.gstAmount);
    expect(doc.total).toBe(order.totalAmount);
    expect(doc.einvStatus).toBe("PENDING");
    // Lines: tea, soap, delivery charge (SAC) — 3 × ₹100 @5% + 2 × ₹50 @18% + ₹30 @18%
    expect(doc.lines.map((l) => [l.hsnCode, l.taxable, l.cgst + l.sgst + l.igst])).toEqual([
      ["0902", 30000, 1500],
      ["3401", 10000, 1800],
      ["996511", 3000, 540],
    ]);
    // Booked: bill numbered as the invoice, receivable = total.
    const bill = await tenantDb(T).bill.findFirstOrThrow({ where: { orderId: order.id } });
    expect(bill.number).toBe(doc.number);
    expect(await receivable(ids.b2b)).toBe(doc.total);
  });

  it("is idempotent: dispatching again or delivering doesn't invoice twice", async () => {
    await dispatch(orderId);
    const order = await tenantDb(T).order.findUniqueOrThrow({ where: { id: orderId } });
    await withMoney(T, adminId, (ctx) => onOrderDelivered(ctx, order, null));
    expect(await tenantDb(T).invoice.count({ where: { orderId } })).toBe(1);
    expect(await tenantDb(T).journalEntry.count({ where: { orderId, kind: "SALE" } })).toBe(1);
  });

  it("an order invoiced at dispatch counts once in credit exposure", async () => {
    const r = await newRetailer();
    const o = await place(r, [{ productId: ids.tea, quantity: 2 }]);
    const before = await withMoney(T, null, (ctx) => khataSummary(ctx, r));
    expect(before.openOrderTotal).toBe(o.totalAmount);
    expect(before.balances.receivable).toBe(0);
    await dispatch(o.id);
    const after = await withMoney(T, null, (ctx) => khataSummary(ctx, r));
    expect(after.balances.receivable).toBe(o.totalAmount);
    expect(after.openOrderTotal).toBe(0);
  });

  it("numbers are gap-free per series", async () => {
    const a = await place(ids.b2c, [{ productId: ids.tea, quantity: 1 }]);
    const b = await place(ids.b2c, [{ productId: ids.tea, quantity: 1 }]);
    await dispatch(a.id);
    await dispatch(b.id);
    const [ia, ib] = [await invoiceOf(a.id), await invoiceOf(b.id)];
    expect(Number(ib.number.slice(-5)) - Number(ia.number.slice(-5))).toBe(1);
    expect(ia.b2b).toBe(false);
    expect(ia.einvStatus).toBe("NOT_REQUIRED"); // B2C: no e-invoice
  });

  it("inter-state retailer gets IGST only", async () => {
    const o = await place(ids.inter, [{ productId: ids.soap, quantity: 4 }]);
    await dispatch(o.id);
    const doc = await invoiceOf(o.id);
    expect(doc.placeOfSupply).toBe("24");
    expect(doc.interState).toBe(true);
    expect(doc.cgst + doc.sgst).toBe(0);
    expect(doc.igst).toBe(o.gstAmount);
  });

  it("with invoicing at delivery, dispatch issues nothing and delivery does", async () => {
    await setSettings({ invoice: invoiceCfg({ issueAt: "delivery" }) });
    try {
      const o = await place(ids.b2c, [{ productId: ids.tea, quantity: 2 }]);
      expect(await dispatch(o.id)).toBeNull();
      expect(await tenantDb(T).invoice.count({ where: { orderId: o.id } })).toBe(0);
      const fresh = await tenantDb(T).order.findUniqueOrThrow({ where: { id: o.id } });
      const { invoice } = await withMoney(T, adminId, (ctx) => onOrderDelivered(ctx, fresh, null));
      expect(invoice?.total).toBe(o.totalAmount);
    } finally {
      await setSettings({ invoice: invoiceCfg() });
    }
  });
});

describe("credit and debit notes", () => {
  let invId = "";
  let teaLine = "";
  let deliveryLine = "";
  let retailer = "";
  beforeAll(async () => {
    retailer = await newRetailer({ gstin: gstin(`27ZZN${run}7Z1Z`.slice(0, 14)) });
    const o = await place(retailer, [{ productId: ids.tea, quantity: 10 }]);
    await dispatch(o.id);
    const doc = await invoiceOf(o.id);
    invId = doc.id;
    teaLine = doc.lines[0].id;
    deliveryLine = doc.lines.find((l) => l.isService)!.id;
  });

  it("return: credits pro rata, reduces the receivable, refuses over-returns", async () => {
    const before = await receivable(retailer);
    const cn = await withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: invId, kind: "return", reason: "3 damaged", lines: [{ lineId: teaLine, quantity: 3 }] }));
    expect(cn.number).toMatch(/^CN\d{4}-\d{5}$/);
    expect(cn.taxable).toBe(30000);
    expect(cn.cgst + cn.sgst).toBe(1500);
    expect(await receivable(retailer)).toBe(before - cn.total);
    await expect(
      withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: invId, kind: "return", reason: "more", lines: [{ lineId: teaLine, quantity: 8 }] }))
    ).rejects.toThrow(/Only 7/);
  });

  it("value credit can't exceed what is left on the line", async () => {
    await expect(
      withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: invId, kind: "value", reason: "rate", lines: [{ lineId: teaLine, amount: 70001 }] }))
    ).rejects.toThrow(/can still be credited/);
    const cn = await withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: invId, kind: "value", reason: "rate", lines: [{ lineId: deliveryLine, amount: 1000 }] }));
    expect(cn.taxable).toBe(1000);
  });

  it("debit note adds a bill and receivable", async () => {
    const before = await receivable(retailer);
    const dn = await withMoney(T, adminId, (ctx) => issueDebitNote(ctx, { invoiceId: invId, reason: "Short-billed", lines: [{ lineId: teaLine, amount: 2000 }] }));
    expect(dn.number).toMatch(/^DN\d{4}-\d{5}$/);
    expect(dn.total).toBe(2100);
    expect(await receivable(retailer)).toBe(before + 2100);
    expect(await tenantDb(T).bill.count({ where: { number: dn.number, kind: "DEBIT_NOTE" } })).toBe(1);
  });

  it("cancel credits exactly what is left: the invoice nets to zero", async () => {
    const cn = await withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: invId, kind: "cancel", reason: "Wrong shop", lines: [] }));
    const docs = await tenantDb(T).invoice.findMany({ where: { OR: [{ id: invId }, { originalId: invId }] } });
    const net = docs.reduce((a, d) => a + (d.type === "CREDIT_NOTE" ? -d.total : d.total), 0);
    expect(net).toBe(0);
    expect(cn.noteKind).toBe("cancel");
    expect(await receivable(retailer)).toBe(0);
    await expect(
      withMoney(T, adminId, (ctx) => issueCreditNote(ctx, { invoiceId: invId, kind: "cancel", reason: "again", lines: [] }))
    ).rejects.toThrow(/Nothing is left/);
  });
});

describe("cancelling after dispatch", () => {
  it("issues a full credit note and gives a prepaid wallet hold back", async () => {
    await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: ids.prepaid, amount: 100_000, method: "UPI", purpose: "WALLET", atOffice: true }));
    const o = await place(ids.prepaid, [{ productId: ids.tea, quantity: 2 }]);
    await dispatch(o.id);
    await withMoney(T, adminId, async (ctx) => {
      const order = await ctx.tx.order.findUniqueOrThrow({ where: { id: o.id } });
      await creditCancelledOrder(ctx, o.id, "Shop closed");
      await onOrderCancelled(ctx, order);
    });
    const docs = await tenantDb(T).invoice.findMany({ where: { orderId: o.id } });
    expect(docs.map((d) => d.type).sort()).toEqual(["CREDIT_NOTE", "TAX_INVOICE"]);
    const b = await withMoney(T, null, (ctx) => retailerBalances(ctx, ids.prepaid));
    expect(b.receivable).toBe(0);
    expect(b.walletAvailable).toBe(100_000);
  });
});

describe("bill of supply", () => {
  it("composition dealer: no GST in the quote, a bill of supply", async () => {
    await setSettings({ invoice: invoiceCfg({ scheme: "composition" }) });
    try {
      const o = await place(ids.b2b, [{ productId: ids.soap, quantity: 2 }]);
      expect(o.gstAmount).toBe(0);
      await dispatch(o.id);
      const doc = await invoiceOf(o.id);
      expect(doc.type).toBe("BILL_OF_SUPPLY");
      expect(doc.number).toMatch(/^BOS/);
      expect(doc.einvStatus).toBe("NOT_REQUIRED");
    } finally {
      await setSettings({ invoice: invoiceCfg() });
    }
  });
});

describe("immutability and e-invoice", () => {
  let id = "";
  beforeAll(async () => {
    const o = await place(ids.b2b, [{ productId: ids.tea, quantity: 1 }]);
    await dispatch(o.id);
    id = (await invoiceOf(o.id)).id;
  });

  it("the database refuses edits and deletes of issued documents", async () => {
    const db = tenantDb(T);
    await expect(db.invoice.update({ where: { id }, data: { total: 1 } })).rejects.toThrow(/cannot be changed/);
    await expect(db.invoice.delete({ where: { id } })).rejects.toThrow(/cannot be deleted/);
    const line = await db.invoiceLine.findFirstOrThrow({ where: { invoiceId: id } });
    await expect(db.invoiceLine.update({ where: { id: line.id }, data: { taxable: 1 } })).rejects.toThrow(/cannot be changed/);
  });

  it("sandbox e-invoice: real IRN formula, stored once", async () => {
    const doc = await generateEInvoice(T, id);
    expect(doc?.einvStatus).toBe("GENERATED");
    expect(doc?.irn).toBe(irnFor(doc!.seller.gstin!, doc!.date, "TAX_INVOICE", doc!.number));
    expect(doc?.signedQr?.split(".")).toHaveLength(3);
    const again = await generateEInvoice(T, id);
    expect(again?.ackNo).toBe(doc?.ackNo);
  });
});

describe("exports from stored documents", () => {
  it("GSTR-1 and Tally include this run's documents and the ledger agrees", async () => {
    const docs = (await tenantDb(T).invoice.findMany({
      where: { retailer: { outletName: { startsWith: `Invoice test ${run}` } } },
      include: { lines: true, original: { select: { id: true, number: true, date: true, b2b: true, interState: true, total: true } }, order: { select: { orderNumber: true } } },
      orderBy: { number: "asc" },
    })) as ExportDoc[];
    const s = gstr1Sections(docs);
    expect(s.b2b.length).toBeGreaterThan(0);
    expect(s.cdnr.length).toBeGreaterThan(0);
    expect(s.b2cs.length).toBeGreaterThan(0);
    const xml = tallyXml(docs, [], INVOICE_DEFAULTS.tally);
    for (const d of docs) expect(xml).toContain(`<VOUCHERNUMBER>${d.number}</VOUCHERNUMBER>`);

    // Sales booked for these retailers = taxable on invoices + debit notes − credit notes.
    const net = docs.reduce((a, d) => a + (d.type === "CREDIT_NOTE" ? -d.taxable : d.taxable), 0);
    const retailerIds = [...new Set(docs.map((d) => d.retailerId))];
    const sales = await tenantDb(T).ledgerLine.aggregate({
      where: { account: { type: "SALES" }, entry: { retailerId: { in: retailerIds } } },
      _sum: { amount: true },
    });
    expect(-(sales._sum.amount ?? 0)).toBe(net);
  });
});
