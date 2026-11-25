/**
 * GST returns (A8): the set-off order, reading GSTR-2B files, and against the
 * real database the GSTR-3B working, the input credit register, settling a
 * month (its entry and the chain of credit carried forward) and the 2B match.
 *
 * Runs in the demo tenant (state 27) with documents dated August and
 * September 2002 (no other test uses them). Sales documents can't be
 * deleted, so the outward figures are checked as differences. Bills,
 * vouchers, settlements and the 2B upload are cancelled or removed after.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { MoneyError, withMoney, type Ctx } from "@/lib/ledger";
import { checkBooks, ensureBooks } from "@/lib/books";
import { recordPurchase, cancelPurchase } from "@/lib/purchases";
import { cancelVoucher, createVoucher } from "@/lib/vouchers";
import { headsTotal, numberKey, periodRange, setOff, shiftPeriod, usedTotal, type Heads } from "@/lib/gst-math";
import { parse2b } from "@/lib/gst-2b";
import { gstinCheckDigit } from "@/lib/gst";
import { itcCsv, itcSheet, matchCsv, monthCsv, monthSheet, monthsCsv } from "@/lib/gst-returns-export";
import { renderSheetPdf } from "@/lib/dues-export";
import { cancelGstSettlement, gstMonth, gstWorking, import2b, itcRegister, match2b, remove2b, settleGst } from "@/lib/gst-returns";

let T = "";
let adminId = "";
const run = String(Date.now()).slice(-6);
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const msg = async (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e) => (e instanceof MoneyError ? e.message : String(e)),
  );
const gstinOf = (first14: string) => first14 + gstinCheckDigit(first14);
const H = (igst: number, cgst: number, sgst: number): Heads => ({ igst, cgst, sgst });
const ids = { local: "", far: "", freight: "", rent: "", retailer: "" };
const bills: string[] = [];
const vouchers: string[] = [];
const AUG = "2002-08";
const SEP = "2002-09";

describe("set-off order", () => {
  it("uses IGST credit first: IGST, then where CGST / SGST credit falls short", () => {
    const s = setOff({ liab: H(100, 50, 50), rcm: H(0, 0, 0), credit: H(300, 0, 0) });
    expect(s.use).toMatchObject({ igstIgst: 100, igstCgst: 50, igstSgst: 50 });
    expect(s.cash).toEqual(H(0, 0, 0));
    expect(s.close).toEqual(H(100, 0, 0));
    const t = setOff({ liab: H(0, 100, 100), rcm: H(0, 0, 0), credit: H(100, 100, 0) });
    expect(t.use).toMatchObject({ igstCgst: 0, igstSgst: 100, cgstCgst: 100 });
    expect(t.cash).toEqual(H(0, 0, 0));
  });

  it("never pays SGST with CGST credit; CGST and SGST credit pay IGST", () => {
    const s = setOff({ liab: H(0, 100, 100), rcm: H(0, 0, 0), credit: H(0, 200, 0) });
    expect(s.use.cgstCgst).toBe(100);
    expect(s.cash).toEqual(H(0, 0, 100));
    expect(s.close).toEqual(H(0, 100, 0));
    const t = setOff({ liab: H(100, 0, 0), rcm: H(0, 0, 0), credit: H(0, 60, 60) });
    expect(t.use).toMatchObject({ cgstIgst: 60, sgstIgst: 40 });
    expect(t.cash).toEqual(H(0, 0, 0));
    expect(t.close).toEqual(H(0, 0, 20));
  });

  it("pays reverse charge and credit taken back in cash", () => {
    const s = setOff({ liab: H(0, 0, 0), rcm: H(0, 10, 10), credit: H(0, 1000, -30) });
    expect(s.cash).toEqual(H(0, 10, 40));
    expect(s.reversal).toEqual(H(0, 0, 30));
    expect(s.close).toEqual(H(0, 1000, 0));
  });

  it("always balances: credit used + cash = tax + reverse charge + credit taken back", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 48271) % 2147483647), seed % 1000);
    for (let i = 0; i < 300; i++) {
      const s = setOff({ liab: H(rnd(), rnd(), rnd()), rcm: H(rnd() % 50, rnd() % 50, rnd() % 50), credit: H(rnd() - 200, rnd() - 200, rnd() - 200) });
      expect(usedTotal(s.use) + headsTotal(s.cash)).toBe(headsTotal(s.liab) + headsTotal(s.rcm) + headsTotal(s.reversal));
      for (const v of [...Object.values(s.use), ...Object.values(s.cash), ...Object.values(s.close)]) expect(v).toBeGreaterThanOrEqual(0);
      expect(s.use.igstIgst + s.use.igstCgst + s.use.igstSgst + s.close.igst).toBe(s.credit.igst);
      expect(s.use.cgstCgst + s.use.cgstIgst + s.close.cgst).toBe(s.credit.cgst);
      // IGST credit is used up before any CGST / SGST credit is touched.
      if (s.close.igst > 0) expect(s.use.cgstCgst + s.use.cgstIgst + s.use.sgstSgst + s.use.sgstIgst + headsTotal(s.cash) - headsTotal(s.rcm) - headsTotal(s.reversal)).toBe(0);
    }
  });

  it("compares supplier numbers loosely and steps months", () => {
    expect(numberKey("inv/0012")).toBe(numberKey("INV-12"));
    expect(numberKey(" a-0100 ")).toBe("A100");
    expect(numberKey("0001")).toBe("1");
    expect(numberKey("2026/27/105")).toBe("202627105");
    expect(periodRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(shiftPeriod("2026-01", -1)).toBe("2025-12");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });
});

describe("reading GSTR-2B files", () => {
  it("reads the portal's JSON (bills and notes, items or totals)", async () => {
    const json = {
      data: {
        gstin: "27ZZDEM0001A1ZA",
        rtnprd: "082002",
        docdata: {
          b2b: [
            {
              ctin: "27aaaaa0000a1z5",
              trdnm: "Local Co",
              inv: [{ inum: "LC/0001", dt: "10-08-2002", val: 1180, rev: "N", itcavl: "Y", items: [{ rt: 18, txval: 1000, cgst: 90, sgst: 90, igst: 0 }] }],
            },
          ],
          cdnr: [{ ctin: "29BBBBB1111B1Z5", trdnm: "Far Co", nt: [{ ntnum: "CN-9", typ: "C", dt: "12-08-2002", val: 59, txval: 50, igst: 9, itcavl: "N" }] }],
        },
      },
    };
    const p = await parse2b(Buffer.from(JSON.stringify(json)), "2b.json");
    expect(p.period).toBe("2002-08");
    expect(p.gstin).toBe("27ZZDEM0001A1ZA");
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ kind: "INV", gstin: "27AAAAA0000A1Z5", number: "LC/0001", date: "2002-08-10", taxable: 100000, cgst: 9000, sgst: 9000, total: 118000, itcAvailable: true });
    expect(p.rows[1]).toMatchObject({ kind: "CN", taxable: 5000, igst: 900, itcAvailable: false });
  });

  it("reads the portal's Excel (title rows, two header rows) and a CSV", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("B2B");
    ws.addRow(["Goods and Services Tax - GSTR-2B"]);
    ws.addRow(["Taxable inward supplies received from registered persons"]);
    ws.addRow([]);
    ws.addRow([
      "GSTIN of supplier",
      "Trade/Legal name",
      "Invoice details",
      "",
      "",
      "",
      "Place of supply",
      "Supply Attract Reverse Charge",
      "Taxable Value (₹)",
      "Tax Amount",
      "",
      "",
      "",
      "ITC Availability",
    ]);
    ws.addRow(["", "", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "", "", "", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", ""]);
    ws.addRow(["27AAAAA0000A1Z5", "Local Co", "LC-1", "Regular", "10/08/2002", 1180, "27-Maharashtra", "N", 1000, 0, 90, 90, 0, "Yes"]);
    ws.addRow(["29BBBBB1111B1Z5", "Far Co", "F 7", "Regular", "11/08/2002", 1050, "27-Maharashtra", "Y", 1000, 50, 0, 0, 0, "No"]);
    const notes = wb.addWorksheet("B2B-CDNR");
    notes.addRow(["GSTIN of supplier", "Trade/Legal name", "Credit note/Debit note details"]);
    notes.addRow([
      "",
      "",
      "Note number",
      "Note type",
      "Note Supply type",
      "Note date",
      "Note Value (₹)",
      "Place of supply",
      "Supply Attract Reverse Charge",
      "Taxable Value (₹)",
      "Integrated Tax(₹)",
      "Central Tax(₹)",
      "State/UT Tax(₹)",
    ]);
    notes.addRow(["27AAAAA0000A1Z5", "Local Co", "CN-1", "Credit Note", "Regular", "20/08/2002", 118, "27", "N", 100, 0, 9, 9]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const p = await parse2b(buf, "GSTR2B.xlsx");
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ kind: "INV", number: "LC-1", date: "2002-08-10", taxable: 100000, cgst: 9000, total: 118000, reverseCharge: false, itcAvailable: true });
    expect(p.rows[1]).toMatchObject({ igst: 5000, reverseCharge: true, itcAvailable: false });
    expect(p.rows[2]).toMatchObject({ kind: "CN", number: "CN-1", taxable: 10000, sgst: 900 });

    const csv =
      'GSTIN of supplier,Trade/Legal name,Invoice number,Invoice date,Invoice value,Taxable value,Integrated tax,Central tax,State/UT tax\r\n27AAAAA0000A1Z5,Local Co,LC-2,2002-08-15,"1,180.00",1000,0,90,90\r\n';
    const c = await parse2b(Buffer.from(csv), "2b.csv");
    expect(c.rows[0]).toMatchObject({ number: "LC-2", date: "2002-08-15", total: 118000, cgst: 9000 });
    await expect(parse2b(Buffer.from("a,b\r\n1,2\r\n"), "x.csv")).rejects.toThrow(/header/);
  });
});

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true } });
  T = demo.id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await as((ctx) => ensureBooks(ctx));
  // Settlements and uploads left by an earlier run of this file.
  await as(async (ctx) => {
    for (const s of await ctx.tx.gstSettlement.findMany({ where: { cancelledAt: null, period: { lt: "2003-01" } }, orderBy: { period: "desc" } }))
      await cancelGstSettlement(ctx, s.id, "Test clean-up");
    await ctx.tx.gstr2bImport.deleteMany({ where: { period: { lt: "2003-01" } } });
  });
  ids.freight = (await db.ledgerHead.findFirstOrThrow({ where: { key: "freight_in" } })).id;
  ids.rent = (await db.ledgerHead.findFirstOrThrow({ where: { key: "rent" } })).id;
  await db.ledgerHead.updateMany({ where: { id: { in: [ids.freight, ids.rent] } }, data: { active: true } });
  ids.local = (await db.supplier.create({ data: { name: `Test GST local ${run}`, gstin: gstinOf(`27AAAAA${run.slice(0, 4)}A1Z`), stateCode: "27", kind: "SERVICES" } })).id;
  ids.far = (await db.supplier.create({ data: { name: `Test GST far ${run}`, gstin: gstinOf(`29BBBBB${run.slice(0, 4)}B1Z`), stateCode: "29", kind: "SERVICES" } })).id;
  ids.retailer = (await db.retailerProfile.findFirstOrThrow()).id;
});

afterAll(async () => {
  await as(async (ctx) => {
    for (const s of await ctx.tx.gstSettlement.findMany({ where: { cancelledAt: null, period: { lt: "2003-01" } }, orderBy: { period: "desc" } }))
      await cancelGstSettlement(ctx, s.id, "Test clean-up");
    await ctx.tx.gstr2bImport.deleteMany({ where: { period: { lt: "2003-01" } } });
    for (const id of vouchers) await cancelVoucher(ctx, id, "Test clean-up");
    for (const id of [...bills].reverse()) await cancelPurchase(ctx, id, "Test clean-up");
  });
  await tenantDb(T).supplier.updateMany({ where: { id: { in: [ids.local, ids.far] } }, data: { active: false } });
});

let saleNo = 0;
const sale = (over: { interState?: boolean; b2b?: boolean; pos?: string; type?: "TAX_INVOICE" | "CREDIT_NOTE"; originalId?: string; taxable: number; rate: number }) => {
  const inter = !!over.interState;
  const tax = Math.round((over.taxable * over.rate) / 100);
  const cgst = inter ? 0 : Math.trunc(tax / 2);
  const t = { taxable: over.taxable, igst: inter ? tax : 0, cgst, sgst: inter ? 0 : tax - cgst };
  return tenantDb(T).invoice.create({
    data: {
      type: over.type ?? "TAX_INVOICE",
      number: `TGST${run}-${++saleNo}`,
      fy: "0203",
      date: new Date("2002-08-14T19:00:00Z"), // 15 Aug 00:30 IST
      retailerId: ids.retailer,
      originalId: over.originalId ?? null,
      noteKind: over.originalId ? "value" : null,
      seller: {},
      buyer: {},
      b2b: over.b2b ?? true,
      placeOfSupply: over.pos ?? "27",
      interState: inter,
      ...t,
      total: t.taxable + t.igst + t.cgst + t.sgst,
      lines: {
        create: [
          {
            tenantId: T,
            sl: 1,
            description: "x",
            unit: "PCS",
            quantity: 1,
            rate: over.taxable,
            gross: over.taxable,
            discount: 0,
            gstRate: over.rate,
            total: t.taxable + t.igst + t.cgst + t.sgst,
            ...t,
          },
        ],
      },
    },
  });
};

describe("the GSTR-3B working", () => {
  it("adds up sales less notes, reverse charge, input credit by source, and exempt inward", async () => {
    const before = await as((ctx) => gstWorking(ctx, AUG));
    const inv = await sale({ taxable: 100_000_00, rate: 18 });
    await sale({ taxable: 20_000_00, rate: 12, interState: true, b2b: false, pos: "29" });
    await sale({ taxable: 10_000_00, rate: 18, type: "CREDIT_NOTE", originalId: inv.id });
    await sale({ taxable: 5_000_00, rate: 0 });

    const b1 = await as((ctx) =>
      recordPurchase(ctx, { supplierId: ids.local, supplierRef: `LC/00${run}`, date: "2002-08-10", lines: [{ target: "HEAD", headId: ids.rent, quantity: 1, rate: 50_000_00, gstRate: 18 }] }),
    );
    const b2 = await as((ctx) =>
      recordPurchase(ctx, {
        supplierId: ids.far,
        supplierRef: `F-${run}`,
        date: "2002-08-11",
        lines: [
          { target: "HEAD", headId: ids.freight, quantity: 1, rate: 10_000_00, gstRate: 12 },
          { target: "HEAD", headId: ids.freight, quantity: 1, rate: 1_000_00, gstRate: 0 },
        ],
      }),
    );
    const rcm = await as((ctx) =>
      recordPurchase(ctx, {
        supplierId: ids.local,
        supplierRef: `GTA-${run}`,
        date: "2002-08-12",
        reverseCharge: true,
        lines: [{ target: "HEAD", headId: ids.freight, quantity: 1, rate: 4_000_00, gstRate: 5 }],
      }),
    );
    const inel = await as((ctx) =>
      recordPurchase(ctx, { supplierId: ids.local, supplierRef: `IN-${run}`, date: "2002-08-13", lines: [{ target: "HEAD", headId: ids.rent, quantity: 1, rate: 1_000_00, gstRate: 18, itc: false }] }),
    );
    const cn = await as((ctx) =>
      recordPurchase(ctx, {
        type: "CREDIT_NOTE",
        supplierId: ids.local,
        supplierRef: `LCN-${run}`,
        date: "2002-08-20",
        againstId: b1.id,
        lines: [{ target: "HEAD", headId: ids.rent, quantity: 1, rate: 5_000_00, gstRate: 18 }],
      }),
    );
    bills.push(b1.id, b2.id, rcm.id, inel.id, cn.id);
    const v = await as((ctx) =>
      createVoucher(ctx, {
        type: "PAYMENT",
        date: "2002-08-21",
        method: "BANK",
        party: "Far Lodge",
        partyGstin: gstinOf(`29CCCCC${run.slice(0, 4)}C1Z`),
        gst: 1_800_00,
        lines: [{ code: `HEAD:${ids.rent}`, amount: 10_000_00 }],
      }),
    );
    vouchers.push(v.id);

    const w = await as((ctx) => gstWorking(ctx, AUG));
    // 3.1(a): 1,00,000 @18 + 20,000 @12 IGST − 10,000 @18; the 0% sale goes to 3.1(c); the 15 Aug 00:30 IST sale is August.
    expect(w.outward.taxable - before.outward.taxable).toBe(110_000_00);
    expect(w.outward.igst - before.outward.igst).toBe(2_400_00);
    expect(w.outward.cgst - before.outward.cgst).toBe(8_100_00);
    expect(w.outward.sgst - before.outward.sgst).toBe(8_100_00);
    expect(w.nil - before.nil).toBe(5_000_00);
    expect((w.interB2c.find((p) => p.pos === "29")?.igst ?? 0) - (before.interB2c.find((p) => p.pos === "29")?.igst ?? 0)).toBe(2_400_00);
    // Inward (only this test's documents are dated August 2002).
    expect(w.rcmInward).toEqual({ taxable: 4_000_00, igst: 0, cgst: 100_00, sgst: 100_00 });
    expect(w.itc.rcm).toEqual(H(0, 100_00, 100_00));
    expect(w.itc.bills).toEqual(H(1_200_00, 4_500_00, 4_500_00));
    expect(w.itc.notes).toEqual(H(0, -450_00, -450_00));
    expect(w.itc.vouchers).toEqual(H(1_800_00, 0, 0));
    expect(w.itc.ineligible).toEqual(H(0, 90_00, 90_00));
    expect(w.itc.net).toEqual(H(3_000_00, 4_150_00, 4_150_00));
    expect(w.exemptIn).toEqual({ inter: 1_000_00, intra: 0 });
    expect(w.counts).toMatchObject({ bills: 4, purchaseNotes: 1, vouchers: 1, rcmBills: 1 });

    const reg = await as((ctx) => itcRegister(ctx, "2002-08-01", "2002-08-31"));
    expect({ igst: reg.totals.igst, cgst: reg.totals.cgst, sgst: reg.totals.sgst }).toEqual(w.itc.net);
    expect(reg.totals.ineligible).toBe(180_00);
    expect(reg.byMonth).toHaveLength(1);
    expect(reg.bySupplier[0].igst + reg.bySupplier[0].cgst + reg.bySupplier[0].sgst).toBeGreaterThan(0);
    expect(reg.byRate.find((r) => r.rate === 12)?.igst).toBe(1_200_00);
    expect(reg.byRate.find((r) => r.rate === null)?.igst).toBe(1_800_00);
    // The exempt bill (no tax at all) is not in the register, so every table adds up to the same taxable value.
    const sum = (xs: { taxable: number }[]) => xs.reduce((s, x) => s + x.taxable, 0);
    expect(sum(reg.byRate)).toBe(reg.totals.taxable);
    expect(sum(reg.byMonth)).toBe(reg.totals.taxable);
    expect(sum(reg.bySupplier)).toBe(reg.totals.taxable);
  });
});

describe("settling a month", () => {
  it("refuses a month not over, and asks for the challan when cash is paid", async () => {
    const now = new Date().toISOString().slice(0, 7);
    expect(await msg(as((ctx) => settleGst(ctx, { period: now, paidOn: "2002-09-15" })))).toMatch(/not over/);
    expect(await msg(as((ctx) => settleGst(ctx, { period: AUG, paidOn: "2002-07-31" })))).toMatch(/before the month/);
    expect(await msg(as((ctx) => settleGst(ctx, { period: AUG, paidOn: "2002-09-20", opening: H(0, 0, 0) })))).toMatch(/challan/);
  });

  it("sets credit off in order, pays the rest from the bank, and carries the credit on", async () => {
    const m = await as((ctx) => gstMonth(ctx, AUG, H(0, 500_00, 500_00)));
    expect(m.openingFrom).toBe("entered");
    expect(m.blocked).toBeNull();
    const s = m.setOff;
    const r = await as((ctx) => settleGst(ctx, { period: AUG, opening: H(0, 500_00, 500_00), paidOn: "2002-09-20", challan: `CIN${run}`, arn: "AA270802123456" }));
    expect(r.cash).toBe(headsTotal(s.cash));
    const lines = await tenantDb(T).ledgerLine.findMany({ where: { entryId: r.entryId! }, include: { account: { select: { type: true } } } });
    const by = (t: string) => lines.filter((l) => l.account.type === t).reduce((a, l) => a + l.amount, 0);
    expect(by("GST_OUTPUT")).toBe(headsTotal(s.liab) + headsTotal(s.rcm));
    expect(by("GST_INPUT")).toBe(headsTotal(s.reversal) - usedTotal(s.use));
    expect(by("BANK")).toBe(-headsTotal(s.cash));
    expect(s.cash.cgst).toBeGreaterThanOrEqual(100_00); // reverse charge is paid in cash

    // Settled: shown as it was; September carries its credit; August can't be settled twice.
    const again = await as((ctx) => gstMonth(ctx, AUG));
    expect(again.settled?.challan).toBe(`CIN${run}`);
    expect(again.setOff).toEqual(s);
    const sep = await as((ctx) => gstMonth(ctx, SEP));
    expect(sep.openingFrom).toBe("previous");
    expect(sep.opening).toEqual(s.close);
    expect(await msg(as((ctx) => settleGst(ctx, { period: AUG, paidOn: "2002-09-20", challan: "X" })))).toMatch(/already settled/);
    expect(await msg(as((ctx) => settleGst(ctx, { period: SEP, paidOn: "2002-10-20", challan: "X", opening: H(1, 1, 1) })))).toMatch(/last month/);
    // Months go in order: July can't be settled after August; October needs September.
    expect((await as((ctx) => gstMonth(ctx, "2002-07"))).blocked).toMatch(/already settled/);
    expect((await as((ctx) => gstMonth(ctx, "2002-10"))).blocked).toMatch(/Settle September 2002 first/);

    // September (nothing in it) settles with no cash; August can't be cancelled under it.
    const r2 = await as((ctx) => settleGst(ctx, { period: SEP, paidOn: "2002-10-20" }));
    expect(r2.cash).toBe(0);
    expect(await msg(as((ctx) => cancelGstSettlement(ctx, r.id, "Wrong")))).toMatch(/Cancel September 2002 first/);
    // Files: the working as PDF and CSV, and months side by side for the CA pack.
    const [aug, sepM] = await Promise.all([as((ctx) => gstMonth(ctx, AUG)), as((ctx) => gstMonth(ctx, SEP))]);
    const pdf = await renderSheetPdf(monthSheet(aug), { name: "Test" });
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
    expect(monthCsv(aug).some((r) => r[1] === "Paid in cash" && r[4] === (s.cash.cgst / 100).toFixed(2))).toBe(true);
    const wide = monthsCsv([aug, sepM]);
    expect(wide[0]).toHaveLength(9);
    expect(wide.find((r) => r[0] === "6.1 Credit carried forward")?.slice(5, 9)).toEqual(
      [s.close.igst, s.close.cgst, s.close.sgst].reduce<(string | number | null)[]>((a, v) => [...a, (v / 100).toFixed(2)], [""]),
    );
    const reg = await as((ctx) => itcRegister(ctx, "2002-08-01", "2002-08-31"));
    expect(itcCsv(reg).length).toBe(reg.docs.length + 2);
    expect((await renderSheetPdf(itcSheet(reg), { name: "Test" })).length).toBeGreaterThan(1000);
    const check = await as((ctx) => checkBooks(ctx));
    expect(check.results.find((x) => x.key === "gst")).toMatchObject({ ok: true });
    await as((ctx) => cancelGstSettlement(ctx, r2.id, "Test"));
    await as((ctx) => cancelGstSettlement(ctx, r.id, "Test"));
    const after = await as((ctx) => checkBooks(ctx));
    expect(after.results.find((x) => x.key === "gst")).toMatchObject({ ok: true });
    expect((await as((ctx) => gstMonth(ctx, AUG))).settled).toBeNull();
  });
});

describe("GSTR-2B match", () => {
  it("matches by GSTIN and number, and lists differences, extras and credit at risk", async () => {
    const db = tenantDb(T);
    const [local, far] = await Promise.all([db.supplier.findUniqueOrThrow({ where: { id: ids.local } }), db.supplier.findUniqueOrThrow({ where: { id: ids.far } })]);
    const p = {
      period: AUG,
      gstin: null,
      skipped: 0,
      rows: [
        // Ours with other spacing and zeros: same bill.
        {
          kind: "INV" as const,
          gstin: local.gstin!,
          name: "Local",
          number: `LC-${run}`,
          numberKey: numberKey(`LC-${run}`),
          date: "2002-08-10",
          taxable: 50_000_00,
          igst: 0,
          cgst: 4_500_00,
          sgst: 4_500_00,
          cess: 0,
          total: 59_000_00,
          reverseCharge: false,
          itcAvailable: true,
        },
        // Their figures differ from ours.
        {
          kind: "INV" as const,
          gstin: far.gstin!,
          name: "Far",
          number: `F${run}`,
          numberKey: numberKey(`F${run}`),
          date: "2002-08-11",
          taxable: 11_000_00,
          igst: 1_500_00,
          cgst: 0,
          sgst: 0,
          cess: 0,
          total: 12_500_00,
          reverseCharge: false,
          itcAvailable: true,
        },
        // Their credit note, and a bill we never entered.
        {
          kind: "CN" as const,
          gstin: local.gstin!,
          name: "Local",
          number: `LCN-${run}`,
          numberKey: numberKey(`LCN-${run}`),
          date: "2002-08-20",
          taxable: 5_000_00,
          igst: 0,
          cgst: 450_00,
          sgst: 450_00,
          cess: 0,
          total: 5_900_00,
          reverseCharge: false,
          itcAvailable: true,
        },
        {
          kind: "INV" as const,
          gstin: "27ZZZZZ9999Z1Z5",
          name: "Stranger",
          number: "S-1",
          numberKey: "S1",
          date: "2002-08-05",
          taxable: 1_000_00,
          igst: 0,
          cgst: 90_00,
          sgst: 90_00,
          cess: 0,
          total: 1_180_00,
          reverseCharge: false,
          itcAvailable: true,
        },
      ],
    };
    expect(await msg(as((ctx) => import2b(ctx, AUG, { ...p, period: SEP }, "2b.json")))).toMatch(/September 2002, not August 2002/);
    await as((ctx) => import2b(ctx, AUG, p, "2b.json"));
    const m = await as((ctx) => match2b(ctx, AUG));
    expect(m.upload?.rows).toBe(4);
    expect(m.matched.map((x) => x.ours?.ref).sort()).toEqual([`LC/00${run}`, `LCN-${run}`].sort());
    expect(m.different).toHaveLength(1);
    expect(m.different[0].diff).toEqual({ taxable: 0, tax: 300_00 });
    expect(m.notInBooks.map((x) => x.theirs?.number)).toEqual(["S-1"]);
    // The reverse charge bill and the one with no credit are not in the 2B: their credit is at risk.
    expect(m.missing.map((x) => x.ours.ref).sort()).toEqual([`GTA-${run}`, `IN-${run}`].sort());
    expect(m.totals.atRisk).toBe(200_00);
    expect(matchCsv(m).length).toBe(1 + m.matched.length + m.different.length + m.missing.length + m.notInBooks.length);
    // A new upload replaces the old one.
    await as((ctx) => import2b(ctx, AUG, { ...p, rows: p.rows.slice(0, 1) }, "again.json"));
    expect((await as((ctx) => match2b(ctx, AUG))).upload?.rows).toBe(1);
    await as((ctx) => remove2b(ctx, AUG));
    expect((await as((ctx) => match2b(ctx, AUG))).upload).toBeNull();
  });
});
