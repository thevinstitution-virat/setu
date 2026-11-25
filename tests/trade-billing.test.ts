/**
 * Trade billing: GST-inclusive rates with dealer-software rounding, the
 * running A-series, the trade bill, and opening bills imported bill by bill.
 * Money figures come from a distributor's real sample bill A004231 (names changed).
 * The database tests add fresh shops to the demo tenant (`npm run db:seed` resets).
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { beforeAll, describe, expect, it } from "vitest";
import { gstInside, lineMoney } from "@/lib/money";
import { runningNumber } from "@/lib/gst";
import { INVOICE_DEFAULTS, invoiceSettings, parseInvoiceSettings } from "@/lib/invoice-settings";
import { finalise, nextRunningNumber, orderDrafts, rateSummary, setNextRunningNumber, type InvoiceDoc, type Party } from "@/lib/invoice";
import { renderTradePdf, tradeLine } from "@/lib/invoice-pdf";
import { validateBills, validateRetailers } from "@/lib/importers";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx } from "@/lib/db";
import { MoneyError, openingBills, retailerBalances, withMoney } from "@/lib/ledger";

/** The five lines of A004231: rates include GST. */
const A004231 = [
  { name: "BABY DIAPER L30", hsn: "96190040", mrp: 39900, rate: 19300, qty: 16, gst: 5 },
  { name: "ALOE VERA SHAVING FOAM 400G", hsn: "34013090", mrp: 24900, rate: 7500, qty: 12, gst: 18 },
  { name: "LEMON SHAVING FOAM 400G", hsn: "34013090", mrp: 24900, rate: 7500, qty: 12, gst: 18 },
  { name: "BABY DIAPER M32", hsn: "96190040", mrp: 39900, rate: 19300, qty: 16, gst: 5 },
  { name: "BABY DIAPER S40", hsn: "96190040", mrp: 39900, rate: 19300, qty: 8, gst: 5 },
];
const CASE = { "96190040": 8, "34013090": 24 } as Record<string, number>;

describe("GST taken out of rates that include it (dealer-software rounding)", () => {
  it("matches A004231 line by line", () => {
    // 16 × 193.00 at 5%: SGST = CGST = 73.52 each.
    expect(gstInside(308800, 5)).toBe(2 * 7352);
    // 12 × 75.00 at 18%: SGST = CGST = 68.64 each.
    expect(gstInside(90000, 18)).toBe(2 * 6864);
    const m = lineMoney(19300, 16, 0, 5, true);
    expect(m).toEqual({ gross: 294096, discount: 0, taxable: 294096, tax: 14704, total: 308800 });
  });
  it("keeps gross − discount = taxable and taxable + tax = total with a discount", () => {
    const m = lineMoney(19300, 16, 3088, 5, true);
    expect(m.total).toBe(308800 - 3088);
    expect(m.gross - m.discount).toBe(m.taxable);
    expect(m.taxable + m.tax).toBe(m.total);
  });
  it("adds GST on top when rates don't include it", () => {
    expect(lineMoney(10000, 2, 500, 5, false)).toEqual({ gross: 20000, discount: 500, taxable: 19500, tax: 975, total: 20475 });
  });
  it("prices the whole bill at ₹9,520 with ₹642.16 GST, split 321.08 + 321.08", () => {
    const lines = A004231.map((l) => lineMoney(l.rate, l.qty, 0, l.gst, true));
    const tax = lines.reduce((a, l) => a + l.tax, 0);
    const total = lines.reduce((a, l) => a + l.total, 0);
    expect(total).toBe(952000);
    expect(tax).toBe(64216);
    const order = {
      orderNumber: "SO-DEO",
      taxInclusive: true,
      subtotal: total - tax,
      gstAmount: tax,
      deliveryCharge: 0,
      deliveryGstRate: 18,
      items: A004231.map((l, i) => ({
        id: `i${i}`,
        productId: `p${i}`,
        quantity: l.qty,
        price: l.rate,
        gstRate: l.gst,
        discount: 0,
        freeSchemeId: null,
        mrp: l.mrp,
        product: { name: l.name, hsnCode: l.hsn, unit: "pcs", caseSize: CASE[l.hsn] },
      })),
    };
    const f = finalise(orderDrafts(order, INVOICE_DEFAULTS), false);
    expect(f.total).toBe(952000);
    expect(f.sgst).toBe(32108);
    expect(f.cgst).toBe(32108);
    expect(f.lines[0]).toMatchObject({ inclRate: 19300, mrp: 39900, caseSize: 8, rate: Math.round(294096 / 16) });
  });
});

describe("running invoice numbers and settings", () => {
  it("prints the A-series like dealer software", () => {
    expect(runningNumber("A", 4262, 6)).toBe("A004262");
    expect(runningNumber("INV", 1, 3)).toBe("INV001");
    expect(() => runningNumber("ABCDE", 123456789012, 8)).toThrow(/16 characters/);
  });
  it("validates numbering, layout and GST-inclusive rates", () => {
    expect(parseInvoiceSettings({ numbering: { style: "running", digits: 6 }, layout: "trade", ratesIncludeGst: true }, INVOICE_DEFAULTS)).toEqual({
      numbering: { style: "running", digits: 6 },
      layout: "trade",
      ratesIncludeGst: true,
    });
    expect(parseInvoiceSettings({ numbering: { digits: 9 } }, INVOICE_DEFAULTS)).toBe("Number width must be 3 to 8 digits");
    expect(parseInvoiceSettings({ layout: "fancy" }, INVOICE_DEFAULTS)).toBe("Bill layout must be standard or trade");
    // Old tenants keep the yearly series and the standard bill.
    expect(invoiceSettings({ invoice: { prefixes: { tax: "A" } } })).toMatchObject({ numbering: { style: "fy", digits: 6 }, layout: "standard", ratesIncludeGst: false });
  });
});

describe("imports from old billing software", () => {
  const today = new Date("2026-11-24T06:00:00Z");
  it("reads open bills, advances and part payments", () => {
    const { valid, errors } = validateBills(
      [
        { party: "Ganesh Kirana", area: "Station Road", invoice_no: "a004231", date: "21/11/2026", bill_value: "9520", received: "520", due_date: "21/11/2026", salesman: "Ravi Sales" },
        { party: "Ganesh Kirana", bill_value: "-250" },
        { party: "Ganesh Kirana", invoice_no: "A004231", date: "21/11/2026", bill_value: "100" },
        { party: "Gupta Stores", invoice_no: "A004300", date: "21/11/2026", bill_value: "100", received: "100" },
        { party: "Gupta Stores", invoice_no: "A004301", date: "30/11/2026", bill_value: "100" },
        { party: "Gupta Stores", bill_value: "100" },
      ],
      today
    );
    expect(valid).toHaveLength(2);
    expect(valid[0]).toMatchObject({ number: "A004231", amount: 952000, paid: 52000, salesman: "Ravi Sales", phone: null });
    expect(valid[1]).toMatchObject({ number: null, amount: -25000 });
    expect(errors.map((e) => e.row)).toEqual([4, 5, 6, 7]);
  });
  it("takes shops without a phone, kept apart by name + area", () => {
    const { valid, errors } = validateRetailers([
      { outlet_name: "Ganesh Kirana", region: "Varanasi", area: "Station Road" },
      { outlet_name: "Ganesh Kirana", region: "Varanasi", area: "Lanka" },
      { outlet_name: "ganesh kirana", region: "Varanasi", area: "station road" },
    ]);
    expect(valid).toHaveLength(2);
    expect(valid[0]).toMatchObject({ phone: null });
    expect(errors).toHaveLength(1);
  });
});

describe("trade bill", () => {
  const seller: Party = {
    legalName: "Shree Traders",
    tradeName: "Shree Traders",
    gstin: "09ZZTRD0001A1Z5",
    stateCode: "09",
    address: "12 Station Road",
    city: "Varanasi",
    pinCode: "221001",
    phone: "9000000001",
  };
  const buyer: Party = { ...seller, legalName: "Ganesh Kirana", tradeName: "Ganesh Kirana", gstin: "09ZZGNK0001B1Z3", address: "Station Road", phone: "9000000002" };

  function doc(): InvoiceDoc {
    const lines = A004231.map((l, i) => {
      const m = lineMoney(l.rate, l.qty, 0, l.gst, true);
      const half = m.tax / 2;
      return {
        id: `l${i}`, tenantId: "t", invoiceId: "x", sl: i + 1, productId: null, orderItemId: null, originalLineId: null,
        description: l.name, hsnCode: l.hsn, isService: false, unit: "PCS", quantity: l.qty, freeQty: 0,
        rate: Math.round(m.gross / l.qty), gross: m.gross, discount: 0, taxable: m.taxable, gstRate: l.gst,
        cgst: half, sgst: half, igst: 0, total: m.total, inclRate: l.rate, mrp: l.mrp, caseSize: CASE[l.hsn],
      };
    });
    const sum = (k: "taxable" | "cgst" | "sgst" | "total") => lines.reduce((a, l) => a + l[k], 0);
    return {
      id: "x", tenantId: "t", type: "TAX_INVOICE", number: "A004231", fy: "2627", date: new Date("2026-11-21T06:00:00Z"),
      orderId: null, retailerId: "r", originalId: null, noteKind: null, reason: null, seller: seller as never, buyer: buyer as never,
      b2b: true, placeOfSupply: "09", interState: false, taxable: sum("taxable"), cgst: sum("cgst"), sgst: sum("sgst"), igst: 0, roundOff: 0,
      total: sum("total"), entryId: null, createdById: null, createdAt: new Date(), updatedAt: new Date(), einvStatus: "NOT_REQUIRED",
      irn: null, ackNo: null, ackDate: null, signedQr: null, einvError: null, einvAttempts: 0, shareVersion: 0, einvCancelledAt: null,
      ewbNo: null, ewbDate: null, ewbValidUntil: null, ewbVehicle: null, ewbDistanceKm: null, salesman: "Ravi Sales",
      title: "Tax Invoice", lines: lines as never, rates: rateSummary(lines as never), words: "Rupees Nine Thousand Five Hundred Twenty Only",
      original: null, notes: [], order: null, dueDate: new Date("2026-11-21T06:00:00Z"), due: 952000, ewayNeeded: false,
      settings: { terms: "Subject to local jurisdiction", bankName: "", bankAccount: "", bankIfsc: "", upiQr: false, ewayThreshold: 5000000, layout: "trade" },
    } as InvoiceDoc;
  }

  it("prints cases + pieces, net rate and amounts with GST as dealer software does", () => {
    const [first, foam] = doc().lines;
    expect(tradeLine(first, true)).toMatchObject({ cases: 2, pieces: 0, caseSize: 8, rate: 19300, net: 19300, amount: 308800, discountPct: 0 });
    expect(tradeLine(foam, true)).toMatchObject({ cases: 0, pieces: 12, caseSize: 24, amount: 90000 });
  });
  it("renders a PDF", async () => {
    const bytes = await renderTradePdf(doc(), { accent: "#1f3a8a" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    if (process.env.TRADE_PDF_OUT) await writeFile(process.env.TRADE_PDF_OUT, bytes);
  });
});

describe("opening bills and the running series (database)", () => {
  let T = "";
  let adminId = "";
  let areaId = "";
  const run = Date.now().toString().slice(-6);

  beforeAll(async () => {
    T = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } })).id;
    const db = tenantDb(T);
    adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
    areaId = (await db.area.findFirstOrThrow()).id;
  });

  async function shop(k: string) {
    const u = await tenantDb(T).user.create({
      data: {
        name: `Opening test ${run}-${k}`,
        phone: null,
        role: "RETAILER",
        retailerProfile: { create: { outletName: `Opening test ${run}-${k}`, shopNumber: "1", complexName: "T", pinCode: "221001", areaId, paymentMode: "POSTPAID", creditDays: 7 } },
      },
      include: { retailerProfile: true },
    });
    return u.retailerProfile!.id;
  }

  it("keeps each bill's number, part payment and salesman, and uses the advance on the oldest bill", async () => {
    const id = await shop("a");
    const d = (s: string) => new Date(`${s}T06:00:00Z`);
    const salesmanId = adminId;
    await withMoney(T, adminId, (ctx) =>
      openingBills(
        ctx,
        id,
        [
          { number: `T${run}B`, date: d("2026-11-10"), dueDate: null, amount: 50000, paid: 0, salesmanId },
          { number: `T${run}A`, date: d("2026-11-01"), dueDate: d("2026-11-15"), amount: 100000, paid: 40000, salesmanId },
        ],
        25000
      )
    );
    const bills = await tenantDb(T).bill.findMany({ where: { retailerId: id }, orderBy: { date: "asc" } });
    expect(bills.map((b) => [b.number, b.kind, b.amount, b.paid, b.salesmanId])).toEqual([
      [`T${run}A`, "OPENING", 100000, 65000, salesmanId],
      [`T${run}B`, "OPENING", 50000, 0, salesmanId],
    ]);
    expect(bills[0].dueDate.toISOString()).toBe(d("2026-11-15").toISOString());
    // No due date given: bill date + the shop's 7 credit days.
    expect(bills[1].dueDate.getTime()).toBeGreaterThan(bills[1].date.getTime());
    const { receivable } = await withMoney(T, adminId, (ctx) => retailerBalances(ctx, id));
    expect(receivable).toBe(60000 + 50000 - 25000);
  });

  it("refuses a second opening, a bill number already used, and checks everything before writing", async () => {
    const id = await shop("b");
    const bill = { number: `T${run}C`, date: new Date(), dueDate: null, amount: 1000, paid: 0, salesmanId: null };
    await withMoney(T, adminId, (ctx) => openingBills(ctx, id, [bill]));
    await expect(withMoney(T, adminId, (ctx) => openingBills(ctx, id, [{ ...bill, number: `T${run}D` }]))).rejects.toThrow(/already has an opening/);
    const other = await shop("c");
    await expect(withMoney(T, adminId, (ctx) => openingBills(ctx, other, [bill]))).rejects.toThrow(/already in VBiz Pro/);
    await expect(withMoney(T, adminId, (ctx) => openingBills(ctx, other, [{ ...bill, number: `T${run}E`, paid: 1000 }]))).rejects.toBeInstanceOf(MoneyError);
    expect(await tenantDb(T).bill.count({ where: { retailerId: other } })).toBe(0);
  });

  it("moves the running series forward only", async () => {
    await withTenantTx(T, async (tx) => {
      const now = await nextRunningNumber(tx, T, "DEBIT_NOTE");
      expect(await setNextRunningNumber(tx, T, "DEBIT_NOTE", now + 10)).toBe(now + 10);
      expect(await nextRunningNumber(tx, T, "DEBIT_NOTE")).toBe(now + 10);
      await expect(setNextRunningNumber(tx, T, "DEBIT_NOTE", now)).rejects.toThrow(/can't go back/);
    });
  });
});
