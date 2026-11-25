/**
 * TDS (A9): the rates and limits, and against the real database TDS kept back
 * on bills, at payment and on vouchers, challans (paid on time and late), the
 * register, the quarterly return working and TDS a shop kept back from us.
 *
 * Runs in the demo tenant with documents dated April to July 2003 (FY 2003-04;
 * no other test uses it). Everything is cancelled or reversed after.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { MoneyError, reversePayment, withMoney, type Ctx } from "@/lib/ledger";
import { checkBooks, ensureBooks } from "@/lib/books";
import { cancelPurchase, recordPurchase } from "@/lib/purchases";
import { cancelSupplierPayment, paySupplier } from "@/lib/supplier-payments";
import { cancelVoucher, createVoucher } from "@/lib/vouchers";
import { renderSheetPdf } from "@/lib/dues-export";
import {
  billTds,
  cancelBillTds,
  cancelTdsChallan,
  deductOnBill,
  payTdsChallan,
  proposeTds,
  recordShopTds,
  return26q,
  saveTdsSection,
  setShopTdsCertificate,
  tdsReceived,
  tdsRegister,
  tdsSections,
  tdsYear,
} from "@/lib/tds";
import { q26Csv, q26Sheet, registerCsv, registerSheet, yearCsv, yearSheet } from "@/lib/tds-export";
import { challanDue, cleanSection, interestMonths, lateInterest, panKind, propose, quarterOf, quarterRange, STARTER_TDS_SECTIONS, tdsOn } from "@/lib/tds-math";

let T = "";
let adminId = "";
const run = String(Date.now()).slice(-6);
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const msg = async (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e) => (e instanceof MoneyError ? e.message : String(e)),
  );
const ids = { contractor: "", freight: "", rent: "", bank: "", retailer: "" };
const bills: string[] = [];
const S = (code: string) => STARTER_TDS_SECTIONS.find((s) => s.code === code)!;
const IND = "AAAPA1234B"; // 4th letter P: an individual
const FIRM = "AAAFA1234B";

describe("rates and limits", () => {
  it("picks the rate by PAN and rounds TDS to the rupee", () => {
    expect(panKind(IND)).toBe("IND");
    expect(panKind(FIRM)).toBe("OTHER");
    expect(panKind("BAD")).toBe("NONE");
    expect(propose(S("194C"), IND, 40_000_00, 0, 0).tds).toBe(400_00);
    expect(propose(S("194C"), FIRM, 40_000_00, 0, 0).tds).toBe(800_00);
    expect(propose(S("194C"), null, 40_000_00, 0, 0).tds).toBe(8_000_00);
    expect(tdsOn(12_345_67, 100)).toBe(123_00);
    expect(tdsOn(12_355_00, 100)).toBe(124_00);
  });

  it("deducts nothing within the limits, and catches up when the year crosses", () => {
    const s = S("194C");
    expect(propose(s, IND, 25_000_00, 0, 0)).toMatchObject({ tds: 0 });
    expect(propose(s, IND, 20_000_00, 65_000_00, 400_00)).toMatchObject({ tds: 0 });
    const p = propose(s, IND, 30_000_00, 85_000_00, 400_00);
    expect(p.tds).toBe(300_00 + 850_00 - 400_00);
    expect(p.why).toMatch(/over ₹1,00,000/);
  });

  it("194Q taxes only the part of the year above ₹50 lakh", () => {
    const s = S("194Q");
    expect(propose(s, FIRM, 10_00_000_00, 30_00_000_00, 0).tds).toBe(0);
    expect(propose(s, FIRM, 30_00_000_00, 30_00_000_00, 0).tds).toBe(tdsOn(10_00_000_00, 10));
    expect(propose(s, null, 10_00_000_00, 60_00_000_00, 0).tds).toBe(tdsOn(10_00_000_00, 500));
  });

  it("knows quarters, due dates and interest months", () => {
    expect([quarterOf("2026-04-01"), quarterOf("2026-09-30"), quarterOf("2026-12-31"), quarterOf("2027-03-31")]).toEqual([1, 2, 3, 4]);
    expect(quarterRange(2026, 4)).toEqual({ from: "2027-01-01", to: "2027-03-31" });
    expect(quarterRange(2026, 1)).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(challanDue("2026-11")).toBe("2026-12-07");
    expect(challanDue("2026-12")).toBe("2027-01-07");
    expect(challanDue("2027-03")).toBe("2027-04-30");
    expect(interestMonths("2003-06-12", "2003-08-20")).toBe(3);
    expect(lateInterest(6_000_00, 3)).toBe(270_00);
    expect(cleanSection("194j(b)")).toBe("194J(B)");
    expect(cleanSection("hello")).toBeNull();
  });
});

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true } });
  T = demo.id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await as((ctx) => ensureBooks(ctx));
  // Challans left by an earlier run of this file.
  await as(async (ctx) => {
    for (const c of await ctx.tx.tdsChallan.findMany({ where: { cancelledAt: null, period: { startsWith: "2003-" } } })) await cancelTdsChallan(ctx, c.id, "Test clean-up");
  });
  ids.freight = (await db.ledgerHead.findFirstOrThrow({ where: { key: "freight_in" } })).id;
  ids.rent = (await db.ledgerHead.findFirstOrThrow({ where: { key: "rent" } })).id;
  await db.ledgerHead.updateMany({ where: { id: { in: [ids.freight, ids.rent] } }, data: { active: true } });
  ids.bank = (await db.bankAccount.findFirstOrThrow({ where: { isDefault: true } })).id;
  ids.contractor = (await db.supplier.create({ data: { name: `Test TDS transport ${run}`, pan: IND, stateCode: "27", kind: "SERVICES", tdsSection: "194C" } })).id;
  ids.retailer = (await db.retailerProfile.findFirstOrThrow()).id;
});

const state = { pay: "", voucher: "", shop: "", credits: [] as string[], challans: [] as string[] };

afterAll(async () => {
  await as(async (ctx) => {
    for (const id of state.challans) {
      const c = await ctx.tx.tdsChallan.findUnique({ where: { id } });
      if (c && !c.cancelledAt) await cancelTdsChallan(ctx, id, "Test clean-up");
    }
    if (state.pay) await cancelSupplierPayment(ctx, state.pay, "Test clean-up");
    if (state.voucher) await cancelVoucher(ctx, state.voucher, "Test clean-up");
    for (const c of await ctx.tx.supplierCredit.findMany({ where: { supplierId: ids.contractor, kind: "TDS" } })) await cancelBillTds(ctx, c.id, "Test clean-up");
    for (const id of [...bills].reverse()) await cancelPurchase(ctx, id, "Test clean-up");
    if (state.shop) await reversePayment(ctx, state.shop, "Test clean-up");
  });
  await tenantDb(T).supplier.updateMany({ where: { id: ids.contractor }, data: { active: false } });
});

const bill = async (date: string, amount: number) => {
  const b = await as((ctx) => recordPurchase(ctx, { supplierId: ids.contractor, supplierRef: `TT${run}-${bills.length + 1}`, date, lines: [{ target: "HEAD", headId: ids.freight, quantity: 1, rate: amount, gstRate: 0 }] }));
  bills.push(b.id);
  return b;
};
const proposeBill = (id: string, date: string, base: number) => as((ctx) => proposeTds(ctx, { section: "194C", supplierId: ids.contractor, base, date, basis: "BILL", excludeId: id }));
const mine = <R extends { party: string }>(rows: R[]) => rows.filter((r) => r.party.includes(run));

describe("TDS kept back", () => {
  it("has the starter sections, and sections can be added and changed", async () => {
    const all = await as((ctx) => tdsSections(ctx, true));
    for (const c of ["194C", "194H", "194I(A)", "194I(B)", "194J(A)", "194J(B)", "194Q"]) expect(all.map((s) => s.code)).toContain(c);
    const code = "194ZT";
    const old = all.find((s) => s.code === code);
    const s = await as((ctx) => saveTdsSection(ctx, { id: old?.id ?? null, code, name: "Test section", rateInd: 100, rateOther: 100, rateNoPan: 2000, single: null, yearly: 1_000_00, overOnly: false, active: false }));
    expect(s).toMatchObject({ code, active: false, yearly: 1_000_00 });
    if (!old) expect(await msg(as((ctx) => saveTdsSection(ctx, { code, name: "Again", rateInd: 1, rateOther: 1, rateNoPan: 1 })))).toMatch(/already there/);
    expect(await msg(as((ctx) => saveTdsSection(ctx, { code: "12AB", name: "Bad", rateInd: 1, rateOther: 1, rateNoPan: 1 })))).toMatch(/looks wrong/);
  });

  it("proposes TDS bill by bill as the year builds up, and keeps it back on the bill", async () => {
    const b1 = await bill("2003-05-10", 25_000_00);
    expect((await proposeBill(b1.id, "2003-05-10", 25_000_00)).tds).toBe(0);
    const b2 = await bill("2003-06-05", 40_000_00);
    const p2 = await proposeBill(b2.id, "2003-06-05", 40_000_00);
    expect(p2).toMatchObject({ tds: 400_00, rate: 100, pan: IND, before: 25_000_00, deducted: 0 });
    const d = await as((ctx) => deductOnBill(ctx, { purchaseBillId: b2.id, section: "194C", base: 40_000_00, tds: p2.tds }));
    state.credits.push(d.id);
    expect(d.number).toMatch(/^TDS\d{4}-\d{5}$/);
    const after = await as((ctx) => billTds(ctx, b2.id));
    expect(after).toMatchObject({ open: 39_600_00, tds: { tds: 400_00, section: "194C", base: 40_000_00 } });
    expect(await msg(as((ctx) => deductOnBill(ctx, { purchaseBillId: b2.id, section: "194C", base: 40_000_00, tds: 100 })))).toMatch(/already kept back/);
    const lines = await tenantDb(T).ledgerLine.findMany({ where: { entry: { kind: "TDS_DEDUCTION", memo: { contains: `TT${run}-2` } } }, include: { account: { select: { type: true } } } });
    expect(lines.find((l) => l.account.type === "TDS_PAYABLE")?.amount).toBe(-400_00);
    expect(lines.find((l) => l.account.type === "PAYABLE")?.amount).toBe(400_00);

    const b3 = await bill("2003-06-20", 20_000_00);
    expect((await proposeBill(b3.id, "2003-06-20", 20_000_00)).tds).toBe(0);
    const b4 = await bill("2003-07-02", 30_000_00);
    const p4 = await proposeBill(b4.id, "2003-07-02", 30_000_00);
    expect(p4).toMatchObject({ before: 85_000_00, deducted: 400_00, tds: 300_00 + 450_00 });
    expect(await msg(as((ctx) => deductOnBill(ctx, { purchaseBillId: b4.id, section: "194C", base: 30_000_00, tds: 31_000_00 })))).toMatch(/more than/);
    state.credits.push((await as((ctx) => deductOnBill(ctx, { purchaseBillId: b4.id, section: "194C", base: 30_000_00, tds: p4.tds, note: "catch-up for the year" }))).id);
  });

  it("keeps TDS at payment and on vouchers, and lists it all in the register", async () => {
    const sb2 = await tenantDb(T).supplierBill.findUniqueOrThrow({ where: { purchaseBillId: bills[1] } });
    const p = await as((ctx) => paySupplier(ctx, { supplierId: ids.contractor, date: "2003-06-25", method: "BANK", bankAccountId: ids.bank, amount: 1_000_00, tds: 100_00, tdsSection: "194C", tdsNote: "on account", billIds: [sb2.id] }));
    state.pay = p.id;
    const v = await as((ctx) =>
      createVoucher(ctx, { type: "PAYMENT", date: "2003-06-12", method: "BANK", bankAccountId: ids.bank, party: `Test landlord ${run}`, partyPan: "AAAPL1234C", lines: [{ code: `HEAD:${ids.rent}`, amount: 60_000_00 }], tds: 6_000_00, tdsSection: "194I(B)" }),
    );
    state.voucher = v.id;
    expect(await msg(as((ctx) => createVoucher(ctx, { type: "PAYMENT", date: "2003-06-12", method: "CASH", party: "X", partyPan: "BAD", lines: [{ code: `HEAD:${ids.rent}`, amount: 100 }] })))).toMatch(/PAN/);
    const vp = await as((ctx) => proposeTds(ctx, { section: "194I(B)", pan: "AAAPL1234C", party: `Test landlord ${run}`, base: 60_000_00, date: "2003-07-12", basis: "PAYMENT" }));
    expect(vp).toMatchObject({ before: 60_000_00, deducted: 6_000_00, tds: 6_000_00 });

    const r = await as((ctx) => tdsRegister(ctx, "2003-04-01", "2003-07-31"));
    const rows = mine(r.rows);
    expect(rows.map((x) => [x.source, x.section, x.tds])).toEqual([
      ["BILL", "194C", 400_00],
      ["VOUCHER", "194I(B)", 6_000_00],
      ["PAYMENT", "194C", 100_00],
      ["BILL", "194C", 750_00],
    ]);
    expect(rows[1]).toMatchObject({ pan: "AAAPL1234C", base: 60_000_00, rate: 1000 });
    expect(rows[2]).toMatchObject({ base: 1_100_00, pan: IND });
    const pdf = await renderSheetPdf(registerSheet(r), { name: "Test", address: null, gstin: null });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    expect(registerCsv(r).length).toBe(r.rows.length + 2);
  });

  it("pays challans, works out interest when late, and maps them in the 26Q working", async () => {
    expect(await msg(as((ctx) => payTdsChallan(ctx, { section: "194C", period: "2003-06", tax: 500_00, paidOn: "2003-07-05", bsrCode: "12345", serial: "00001" })))).toMatch(/BSR/);
    const c1 = await as((ctx) => payTdsChallan(ctx, { section: "194C", period: "2003-06", tax: 500_00, bankAccountId: ids.bank, paidOn: "2003-07-05", bsrCode: "0510002", serial: `1${run.slice(-4)}` }));
    state.challans.push(c1.id);
    expect(c1.number).toMatch(/^TC\d{4}-\d{5}$/);
    expect(await msg(as((ctx) => payTdsChallan(ctx, { section: "194C", period: "2003-06", tax: 500_00, paidOn: "2003-07-05", bsrCode: "0510002", serial: `1${run.slice(-4)}` })))).toMatch(/already entered/);
    const c2 = await as((ctx) => payTdsChallan(ctx, { section: "194I(B)", period: "2003-06", tax: 6_000_00, interest: 270_00, bankAccountId: ids.bank, paidOn: "2003-08-20", bsrCode: "0510002", serial: `2${run.slice(-4)}` }));
    state.challans.push(c2.id);
    const lines = await tenantDb(T).ledgerLine.findMany({ where: { entry: { kind: "TDS_PAYMENT", memo: { contains: `0510002/2${run.slice(-4)}` } } }, include: { account: { select: { type: true, name: true } } } });
    expect(lines.find((l) => l.account.type === "TDS_PAYABLE")?.amount).toBe(6_000_00);
    expect(lines.find((l) => l.account.type === "HEAD")?.amount).toBe(270_00);
    expect(lines.find((l) => l.account.type === "BANK")?.amount).toBe(-6_270_00);

    const y = await as((ctx) => tdsYear(ctx, 2003));
    const g = (period: string, section: string) => y.groups.find((x) => x.period === period && x.section === section)!;
    expect(g("2003-06", "194C")).toMatchObject({ deducted: 500_00, paid: 500_00, status: "PAID", interest: 0 });
    expect(g("2003-06", "194I(B)")).toMatchObject({ paid: 6_000_00, status: "PAID_LATE", interest: 270_00, interestDue: 0 });
    expect(g("2003-07", "194C")).toMatchObject({ deducted: 750_00, paid: 0, status: "LATE" });
    expect(g("2003-07", "194C").interest).toBeGreaterThan(0);
    expect(yearCsv(y).length).toBeGreaterThan(3);
    expect((await renderSheetPdf(yearSheet(y), { name: "Test", address: null, gstin: null })).byteLength).toBeGreaterThan(1000);

    const q = await as((ctx) => return26q(ctx, 2003, 1));
    const rows = mine(q.rows);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.covered).toBe(r.tds);
    expect(rows.find((r) => r.section === "194I(B)")?.challan).toMatchObject({ bsrCode: "0510002", serial: `2${run.slice(-4)}`, paidOn: "2003-08-20" });
    expect(q.due).toBe("2003-07-31");
    expect(q26Csv(q)[0][0]).toBe("Challan BSR code");
    expect((await renderSheetPdf(q26Sheet(q), { name: "Test", address: null, gstin: null })).byteLength).toBeGreaterThan(1000);
  });

  it("records TDS a shop kept back, and its certificate", async () => {
    const p = await as((ctx) => recordShopTds(ctx, { retailerId: ids.retailer, amount: 150_00, section: "194q", date: "2003-06-30" }));
    state.shop = p.id;
    expect(p.number).toMatch(/^TDS-/);
    const pay = await tenantDb(T).payment.findUniqueOrThrow({ where: { id: p.id }, include: { allocations: true } });
    expect(pay).toMatchObject({ method: "TDS", state: "CONFIRMED", tdsSection: "194Q" });
    const lines = await tenantDb(T).ledgerLine.findMany({ where: { entryId: pay.entryId! }, include: { account: { select: { type: true } } } });
    expect(lines.find((l) => l.account.type === "TDS_RECEIVABLE")?.amount).toBe(150_00);
    expect(lines.find((l) => l.account.type === "RECEIVABLE")?.amount).toBe(-150_00);
    let r = await as((ctx) => tdsReceived(ctx, "2003-06-01", "2003-06-30"));
    expect(r.rows.find((x) => x.id === p.id)).toMatchObject({ tds: 150_00, certificate: null, section: "194Q" });
    await as((ctx) => setShopTdsCertificate(ctx, p.id, "ABCD1234567"));
    r = await as((ctx) => tdsReceived(ctx, "2003-06-01", "2003-06-30"));
    expect(r.rows.find((x) => x.id === p.id)?.certificate).toBe("ABCD1234567");
  });

  it("undoes TDS on a bill and a challan, and the books check stays clean", async () => {
    const credit = state.credits[1];
    await as((ctx) => cancelBillTds(ctx, credit, "Entered twice"));
    expect((await as((ctx) => billTds(ctx, bills[3]))).tds).toBeNull();
    expect((await as((ctx) => billTds(ctx, bills[3]))).open).toBe(30_000_00);
    expect(mine((await as((ctx) => tdsRegister(ctx, "2003-07-01", "2003-07-31"))).rows)).toHaveLength(0);
    await as((ctx) => cancelTdsChallan(ctx, state.challans[0], "Wrong section"));
    const y = await as((ctx) => tdsYear(ctx, 2003));
    expect(y.groups.find((x) => x.period === "2003-06" && x.section === "194C")).toMatchObject({ paid: 0, status: "LATE" });
    const check = await as((ctx) => checkBooks(ctx));
    expect(check.results.find((x) => x.key === "tds")).toMatchObject({ ok: true });
  });
});
