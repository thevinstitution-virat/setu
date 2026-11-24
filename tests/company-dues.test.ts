/**
 * Company-wise outstanding against the real database: a bill raised here is
 * split by its invoice lines (GST included) by each product's company, a bill
 * from the old book by its imported split, payments in proportion, and the
 * bill_shares import (±₹1 rule, refusals). Also the PDF, CSV and summary.
 *
 * Everything lives in a fresh area of the demo tenant; settings are restored.
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx } from "@/lib/db";
import { bookSale, openingBills, recordPayment, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { INVENTORY_DEFAULTS } from "@/lib/inventory-settings";
import { NO_COMPANY, UNSPLIT, apportion, loadDues } from "@/lib/dues-reports";
import { csvFor, renderSheetPdf, sheetFor, summaryText } from "@/lib/dues-export";
import { applyBillShares } from "@/lib/bill-shares";
import { validateBillShares } from "@/lib/importers";

let T = "";
let adminId = "";
let areaId = "";
let shopId = "";
let original: unknown = null;
let invoiceNo = "";
const run = Date.now().toString().slice(-6);
const co = { x: { id: "", name: `AAA Co X ${run}` }, y: { id: "", name: `AAA Co Y ${run}` }, fresh: `AAA New Co ${run}` };
const d = (s: string) => new Date(`${s}T06:00:00Z`);
const q = (o: Record<string, string> = {}) => new URLSearchParams({ areaId, ...o });
const share = (rows: Record<string, string>[]) => withTenantTx(T, (tx) => applyBillShares(tx, validateBillShares(rows).valid));

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const region = (await db.area.findFirstOrThrow()).regionId;
  areaId = (await db.area.create({ data: { name: `Company dues ${run}`, regionId: region } })).id;
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(original as object),
        cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
        invoice: { ...INVOICE_DEFAULTS, city: "Varanasi", pinCode: "221001", issueAt: "dispatch", ratesIncludeGst: false, einvoice: { enabled: false, provider: "sandbox" } },
        inventory: INVENTORY_DEFAULTS,
      } as object,
    },
  });

  co.x.id = (await db.supplier.create({ data: { name: co.x.name } })).id;
  co.y.id = (await db.supplier.create({ data: { name: co.y.name } })).id;
  const cat = (await db.category.create({ data: { name: `Company dues cat ${run}` } })).id;
  const mk = (sku: string, price: number, gstRate: number, supplierId: string | null) =>
    db.product.create({ data: { name: `Test co dues ${sku} ${run}`, sku: `COD-${sku}-${run}`, categoryId: cat, unit: "pc", price, mrp: price * 2, gstRate, hsnCode: "0902", supplierId } });
  const tea = await mk("TEA", 10000, 5, co.x.id); // ₹105.00 with GST
  const soap = await mk("SOAP", 5000, 18, co.y.id); // ₹59.00
  const loose = await mk("LOOSE", 2000, 0, null); // ₹20.00, no company

  const u = await db.user.create({
    data: {
      name: `Company dues shop ${run}`,
      phone: null,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Company dues shop ${run}`, shopNumber: "4", complexName: "Godowlia", pinCode: "221001", areaId, paymentMode: "POSTPAID", creditDays: 7, creditLimit: null } },
    },
    include: { retailerProfile: true },
  });
  shopId = u.retailerProfile!.id;

  // A bill raised here (one of each product), half of it paid in cash against the order.
  const { order } = await withMoney(T, adminId, (ctx) =>
    placeOrder(ctx, {
      retailerId: shopId,
      placedById: adminId,
      items: [
        { productId: tea.id, quantity: 1 },
        { productId: soap.id, quantity: 1 },
        { productId: loose.id, quantity: 1 },
      ],
    })
  );
  const { invoice } = await withMoney(T, adminId, (ctx) => bookSale(ctx, order.id));
  invoiceNo = invoice!.number;
  // Two bills from the old book, the first part paid there.
  await withMoney(T, adminId, (ctx) =>
    openingBills(ctx, shopId, [
      { number: `CD${run}1`, date: d("2026-11-01"), dueDate: null, amount: 30000, paid: 6000, salesmanId: null },
      { number: `CD${run}2`, date: d("2026-11-02"), dueDate: null, amount: 10000, paid: 0, salesmanId: null },
    ])
  );
  await withMoney(T, adminId, (ctx) => recordPayment(ctx, { retailerId: shopId, orderId: order.id, amount: 9200, method: "CASH", occurredAt: new Date(), atOffice: true }));
});

afterAll(async () => {
  if (T) await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
});

describe("apportion", () => {
  it("splits whole paise that add up exactly, biggest remainders first", () => {
    expect(apportion(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(apportion(18400, [10500, 5900, 2000])).toEqual([10500, 5900, 2000]);
    expect(apportion(9200, [10500, 5900, 2000])).toEqual([5250, 2950, 1000]);
    expect(apportion(7, [0, 0])).toEqual([7, 0]);
    expect(apportion(5, [0, 3])).toEqual([0, 5]);
  });
});

describe("company split import", () => {
  it("checks rows, refuses bills raised here, and puts up to ₹1 difference on the biggest share", async () => {
    expect(validateBillShares([{ invoice_no: "x1", company: "A", value: "0" }]).errors[0].message).toMatch(/more than 0/);
    expect(
      validateBillShares([
        { invoice_no: "x1", company: "A  Co", value: "1" },
        { invoice_no: "X1", company: "a co", value: "2" },
      ]).errors[0].message
    ).toMatch(/twice \(first on row 2\)/);

    const bad = await share([
      { invoice_no: invoiceNo, company: co.x.name, value: "184" },
      { invoice_no: `CD${run}2`, company: co.x.name, value: "50" },
      { invoice_no: `NOPE${run}`, company: co.x.name, value: "1" },
    ]);
    expect(bad.errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/was raised here/),
      expect.stringMatching(/add up to ₹50\.00; the bill is ₹100\.00/),
      expect.stringMatching(/No bill NOPE/),
    ]);

    // ₹299.50 for a ₹300 bill: the 50 paise go on the biggest share. A new company is created.
    const ok = await share([
      { invoice_no: `CD${run}1`, company: co.x.name.toLowerCase(), value: "200" },
      { invoice_no: `CD${run}1`, company: co.fresh, value: "99.50" },
    ]);
    expect(ok).toEqual({ created: 1, updated: 0, errors: [] });
    const db = tenantDb(T);
    const bill = await db.bill.findFirstOrThrow({ where: { number: `CD${run}1` }, include: { shares: { include: { supplier: true }, orderBy: { amount: "desc" } } } });
    expect(bill.shares.map((s) => [s.supplier?.name, s.amount])).toEqual([
      [co.x.name, 20050],
      [co.fresh, 9950],
    ]);
    // Importing again replaces the split.
    expect(await share([{ invoice_no: `CD${run}1`, company: co.x.name, value: "200" }, { invoice_no: `CD${run}1`, company: co.fresh, value: "100" }])).toMatchObject({ created: 0, updated: 1 });
  });
});

describe("company-wise outstanding", () => {
  it("splits invoices by their lines, old bills by their import, and payments in proportion", async () => {
    const r = await loadDues(T, "companies", q());
    if (r.view !== "companies") throw new Error("view");
    const got = r.companies.map((c) => [c.company, c.rows.map((x) => [x.bill.number, x.share.amount, x.share.received, x.share.balance])]);
    expect(got).toEqual([
      [
        co.x.name,
        [
          [`CD${run}1`, 20000, 4000, 16000],
          [invoiceNo, 10500, 5250, 5250],
        ],
      ],
      [co.y.name, [[invoiceNo, 5900, 2950, 2950]]],
      [co.fresh, [[`CD${run}1`, 10000, 2000, 8000]]],
      ["No company", [[invoiceNo, 2000, 1000, 1000]]],
      ["Not split", [[`CD${run}2`, 10000, 0, 10000]]],
    ]);
    expect(r.companies.at(-2)!.key).toBe(NO_COMPANY);
    expect(r.companies.at(-1)!.key).toBe(UNSPLIT);
    expect(r.companies[0].parties).toBe(1);

    // The shares add up to the bill-wise outstanding.
    const bills = await loadDues(T, "bills", q());
    if (bills.view !== "bills") throw new Error("view");
    expect(r.totals).toEqual(bills.totals);
    expect(r.totals.balance).toBe(18400 + 30000 + 10000 - 9200 - 6000);
  });

  it("filters by company", async () => {
    const r = await loadDues(T, "companies", q({ companyId: co.y.id }));
    if (r.view !== "companies") throw new Error("view");
    expect(r.companies.map((c) => c.company)).toEqual([co.y.name]);
    expect(r.totals.balance).toBe(2950);
  });

  it("prints as a PDF, a CSV and a WhatsApp summary", async () => {
    const r = await loadDues(T, "companies", q());
    const pdf = await renderSheetPdf(sheetFor(r, "Area: test"), { name: "Shree Traders", address: "Station Road", gstin: null });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
    if (process.env.DUES_PDF_OUT) await writeFile(path.join(process.env.DUES_PDF_OUT, "companies.pdf"), pdf);
    const csv = csvFor(r);
    expect(csv).toHaveLength(7);
    expect(csv[1].slice(0, 2)).toEqual([co.x.name, `Company dues shop ${run}`]);
    expect(summaryText(r, "Shree Traders", "")).toMatch(new RegExp(`Outstanding ₹432\\.00 across 3 companies \\(${co.x.name} ₹212\\.50, `));
  });
});
