/**
 * Paying suppliers (A3) against the real database: bank, cash and cheque
 * payments set against picked bills then the oldest, advances, TDS kept back,
 * our cheques clearing / bouncing, cancelling, bank-statement matching of
 * money going out (on the statement's own bank), and the payables reports.
 *
 * Runs in the demo tenant with fresh suppliers; they are hidden after.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, MoneyError, withMoney, type Ctx } from "@/lib/ledger";
import { checkBooks, createBank, ensureBooks, todayIst } from "@/lib/books";
import { recordPurchase } from "@/lib/purchases";
import {
  billsFallingDue,
  cancelSupplierPayment,
  clearIssuedCheque,
  openBillsOn,
  payablesBySupplier,
  paymentDetail,
  paymentsList,
  paySupplier,
  type PayInput,
} from "@/lib/supplier-payments";
import { billsCsv, billsSheet, bySupplierSheet, dueSheet, payablesSummary, paymentsCsv, paymentsSheet } from "@/lib/payables-export";
import { ignoreLine, importStatement, matchLine, unmatchLine } from "@/lib/bank";
import { renderSheetPdf } from "@/lib/dues-export";
import { can } from "@/lib/permissions";

let T = "";
let adminId = "";
let mainBank = { id: "", code: "" };
let bank2 = { id: "", code: "" };
const run = Date.now().toString().slice(-6);
const today = todayIst();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const code = async (p: Promise<unknown>) => p.then(() => 0, (e) => (e instanceof MoneyError ? e.status : -1));
const ids = { a: "", b: "", c: "", head: "" };
const owed = async (supplierId: string) => -(await as((ctx) => balanceOf(ctx, { type: "PAYABLE", supplierId })));
const bankBal = async (bankAccountId: string) => as((ctx) => balanceOf(ctx, { type: "BANK", bankAccountId }));
const acc = async (type: "ISSUED_CHEQUES" | "TDS_PAYABLE" | "OFFICE_CASH") => as((ctx) => balanceOf(ctx, { type }));
const entryLines = async (entryId: string) => {
  const lines = await tenantDb(T).ledgerLine.findMany({ where: { entryId }, include: { account: true } });
  return Object.fromEntries(lines.map((l) => [l.account.code, l.amount]));
};
/** A bill for a head (no stock), in paise. Returns the supplier bill. */
const bill = async (supplierId: string, amount: number, date = daysAgo(2)) => {
  const doc = await as((ctx) => recordPurchase(ctx, { supplierId, supplierRef: `SP-${run}-${Math.random().toString(36).slice(2, 8)}`, date, lines: [{ target: "HEAD", headId: ids.head, quantity: 1, rate: amount, gstRate: 0 }] }));
  return tenantDb(T).supplierBill.findUniqueOrThrow({ where: { purchaseBillId: doc.id } });
};
const pay = (over: Partial<PayInput>) => as((ctx) => paySupplier(ctx, { supplierId: ids.a, date: today, method: "BANK", bankAccountId: mainBank.id, amount: 100, ...over }));
const sb = (id: string) => tenantDb(T).supplierBill.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, stateCode: true } });
  T = demo.id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await as((ctx) => ensureBooks(ctx));
  const def = await db.bankAccount.findFirstOrThrow({ where: { isDefault: true } });
  mainBank = { id: def.id, code: def.ledgerCode };
  const b2 = await as((ctx) => createBank(ctx, { name: `Test ICICI ${run}` }));
  bank2 = { id: b2.id, code: b2.ledgerCode };
  const st = demo.stateCode ?? "27";
  ids.a = (await db.supplier.create({ data: { name: `Test payee alpha ${run}`, stateCode: st, creditDays: 15 } })).id;
  ids.b = (await db.supplier.create({ data: { name: `Kaveri Traders ${run}`, kind: "SERVICES", stateCode: st, tdsSection: "194C" } })).id;
  ids.c = (await db.supplier.create({ data: { name: `Test payee gamma ${run}`, stateCode: st, creditDays: 15 } })).id;
  ids.head = (await db.ledgerHead.findFirstOrThrow({ where: { active: true, group: "INDIRECT_EXPENSES" } })).id;
});

afterAll(async () => {
  await tenantDb(T).supplier.updateMany({ where: { id: { in: [ids.a, ids.b, ids.c] } }, data: { active: false } });
});

describe("paying a supplier", () => {
  it("lets the accountant pay suppliers, not the sales agent", () => {
    expect(can("ACCOUNTANT", "payables.pay")).toBe(true);
    expect(can("SALES_AGENT", "payables.pay")).toBe(false);
  });

  it("settles the picked bill first, then the oldest, from the bank", async () => {
    const b1 = await bill(ids.a, 100_000, daysAgo(40));
    const b2 = await bill(ids.a, 50_000, daysAgo(20));
    const b3 = await bill(ids.a, 30_000, daysAgo(5));
    const owed0 = await owed(ids.a);
    const bank0 = await bankBal(mainBank.id);
    const p = await pay({ amount: 60_000, billIds: [b2.id], reference: `UTR${run}0001` });
    expect(p.number).toMatch(/^SP\d{4}-\d{5}$/);
    expect(p).toMatchObject({ method: "BANK", bankAccountId: mainBank.id, amount: 60_000, tds: 0 });
    const l = await entryLines(p.entryId!);
    expect(l[`PAYABLE:${ids.a}`]).toBe(60_000);
    expect(l[mainBank.code]).toBe(-60_000);
    expect(await sb(b2.id)).toMatchObject({ paid: 50_000, settled: true });
    expect(await sb(b1.id)).toMatchObject({ paid: 10_000, settled: false });
    expect((await sb(b3.id)).paid).toBe(0);
    expect(owed0 - (await owed(ids.a))).toBe(60_000);
    expect((await bankBal(mainBank.id)) - bank0).toBe(-60_000);
    const d = await as((ctx) => paymentDetail(ctx, p.id));
    expect(d.allocations.map((x) => x.amount)).toEqual([50_000, 10_000]);
    expect(d.advance).toBe(0);
  });

  it("keeps an overpayment as an advance that the next bill uses", async () => {
    const open = (await tenantDb(T).supplierBill.findMany({ where: { supplierId: ids.a, settled: false } })).reduce((a, b) => a + b.amount - b.paid, 0);
    const p = await pay({ amount: open + 25_000 });
    expect((await as((ctx) => paymentDetail(ctx, p.id))).advance).toBe(25_000);
    expect(await owed(ids.a)).toBe(-25_000);
    const next = await bill(ids.a, 20_000);
    expect(await sb(next.id)).toMatchObject({ paid: 20_000, settled: true });
    expect(await owed(ids.a)).toBe(-5_000);
  });

  it("keeps TDS back under the supplier's section", async () => {
    const b = await bill(ids.b, 1_000_000);
    const tds0 = await acc("TDS_PAYABLE");
    const p = await pay({ supplierId: ids.b, amount: 990_000, tds: 10_000, billIds: [b.id] });
    expect(p).toMatchObject({ tds: 10_000, tdsSection: "194C" });
    const l = await entryLines(p.entryId!);
    expect(l[`PAYABLE:${ids.b}`]).toBe(1_000_000);
    expect(l[mainBank.code]).toBe(-990_000);
    expect(l.TDS_PAYABLE).toBe(-10_000);
    expect(await sb(b.id)).toMatchObject({ paid: 1_000_000, settled: true });
    expect((await acc("TDS_PAYABLE")) - tds0).toBe(-10_000);
    // No section on the supplier and none given: refused.
    expect(await code(pay({ amount: 1000, tds: 100 }))).toBe(400);
  });

  it("pays cash from the office", async () => {
    const cash0 = await acc("OFFICE_CASH");
    const p = await pay({ method: "CASH", amount: 4_000, bankAccountId: null });
    expect(p.bankAccountId).toBeNull();
    expect((await entryLines(p.entryId!)).OFFICE_CASH).toBe(-4_000);
    expect((await acc("OFFICE_CASH")) - cash0).toBe(-4_000);
  });

  it("refuses a future date, no amount, and another supplier's bill", async () => {
    const other = await bill(ids.c, 5_000);
    const tomorrow = new Date(Date.now() + 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    expect(await code(pay({ date: tomorrow }))).toBe(400);
    expect(await code(pay({ amount: 0 }))).toBe(400);
    expect(await code(pay({ billIds: [other.id] }))).toBe(400);
    expect(await code(pay({ bankAccountId: "nope" }))).toBe(404);
  });

  it("cancels a payment entered by mistake and opens its bills again", async () => {
    const b = await bill(ids.c, 7_000);
    const owed0 = await owed(ids.c);
    const p = await pay({ supplierId: ids.c, amount: 7_000, billIds: [b.id] });
    expect((await sb(b.id)).settled).toBe(true);
    expect(await code(as((ctx) => cancelSupplierPayment(ctx, p.id, "")))).toBe(400);
    await as((ctx) => cancelSupplierPayment(ctx, p.id, "Wrong supplier"));
    expect(await sb(b.id)).toMatchObject({ paid: 0, settled: false });
    expect(await owed(ids.c)).toBe(owed0);
    expect(await code(as((ctx) => cancelSupplierPayment(ctx, p.id, "again")))).toBe(409);
    expect(await code(as((ctx) => cancelSupplierPayment(ctx, p.id, "bounce", "BOUNCED")))).toBe(409);
  });
});

describe("our cheques", () => {
  it("holds a cheque in Cheques issued until our bank pays it", async () => {
    const b = await bill(ids.c, 70_000);
    const chq0 = await acc("ISSUED_CHEQUES");
    const bank0 = await bankBal(mainBank.id);
    const no = `7${run}`;
    const p = await pay({ supplierId: ids.c, method: "CHEQUE", amount: 70_000, cheque: { number: no }, billIds: [b.id] });
    expect(p.cheque).toMatchObject({ number: no, status: "ISSUED", amount: 70_000, bankAccountId: mainBank.id });
    expect((await entryLines(p.entryId!)).ISSUED_CHEQUES).toBe(-70_000);
    expect((await acc("ISSUED_CHEQUES")) - chq0).toBe(-70_000);
    expect(await bankBal(mainBank.id)).toBe(bank0);
    expect(await code(pay({ supplierId: ids.c, method: "CHEQUE", amount: 100, cheque: { number: no } }))).toBe(409);
    expect(await code(pay({ supplierId: ids.c, method: "CHEQUE", amount: 100, cheque: { number: "" } }))).toBe(400);

    const ch = await as((ctx) => clearIssuedCheque(ctx, p.cheque!.id, today));
    expect(ch.status).toBe("CLEARED");
    expect((await acc("ISSUED_CHEQUES")) - chq0).toBe(0);
    expect((await bankBal(mainBank.id)) - bank0).toBe(-70_000);
    expect(await code(as((ctx) => clearIssuedCheque(ctx, p.cheque!.id, today)))).toBe(409);
    expect(await code(as((ctx) => cancelSupplierPayment(ctx, p.id, "Bounced", "BOUNCED")))).toBe(409);
  });

  it("reverses the payment and reopens the bills when our cheque bounces", async () => {
    const b = await bill(ids.c, 40_000);
    const owed0 = await owed(ids.c);
    const chq0 = await acc("ISSUED_CHEQUES");
    const p = await pay({ supplierId: ids.c, method: "CHEQUE", amount: 40_000, cheque: { number: `6${run}` }, billIds: [b.id] });
    await as((ctx) => cancelSupplierPayment(ctx, p.id, "Signature mismatch", "BOUNCED"));
    expect((await tenantDb(T).issuedCheque.findUniqueOrThrow({ where: { id: p.cheque!.id } })).status).toBe("BOUNCED");
    expect(await sb(b.id)).toMatchObject({ paid: 0, settled: false });
    expect(await owed(ids.c)).toBe(owed0);
    expect(await acc("ISSUED_CHEQUES")).toBe(chq0);
    const cash = await pay({ supplierId: ids.c, method: "CASH", amount: 100, bankAccountId: null });
    expect(await code(as((ctx) => cancelSupplierPayment(ctx, cash.id, "bounce", "BOUNCED")))).toBe(400);
    await as((ctx) => cancelSupplierPayment(ctx, cash.id, "Test only"));
  });
});

describe("bank statement, money out", () => {
  it("matches our payments and cheques on the statement's own bank, and enters new payments", async () => {
    const utr = `UTRX${run}55`;
    const p1 = await pay({ bankAccountId: bank2.id, amount: 12_345, reference: utr });
    const p2 = await pay({ supplierId: ids.b, method: "CHEQUE", bankAccountId: bank2.id, amount: 23_456, cheque: { number: `8${run}` } });
    const elsewhere = await pay({ amount: 1_999, reference: `UTRZ${run}77` }); // main bank
    const bal0 = await bankBal(bank2.id);
    const csv = [
      "Date,Narration,Ref No,Debit,Credit,Balance",
      `${today},NEFT/${utr}/alpha ${run},,123.45,,`,
      `${today},CHQ PAID 8${run},8${run},234.56,,`,
      `${today},NEFT KAVERI TRADERS ${run},,345.67,,`,
      `${today},NEFT/UTRZ${run}77/elsewhere,,19.99,,`,
      `${today},BY CASH DEPOSIT ${run},,,500.00,`,
    ].join("\n");
    const r = await importStatement(T, adminId, { fileName: `out-${run}.csv`, bankAccountId: bank2.id, bytes: Buffer.from(csv) });
    expect(r.statement).toMatchObject({ bankAccountId: bank2.id, account: `Test ICICI ${run}`, lineCount: 5 });
    expect(r.matched).toBe(2);
    const lines = await tenantDb(T).bankLine.findMany({ where: { statementId: r.statement.id } });
    const out = (d: number) => lines.find((l) => l.debit === d)!;
    expect(out(12_345)).toMatchObject({ status: "MATCHED", matchKind: "SUPPLIER_PAY", matchRef: p1.id });
    expect(out(23_456)).toMatchObject({ status: "MATCHED", matchKind: "ISSUED_CHEQUE", matchRef: p2.cheque!.id });
    expect((await tenantDb(T).issuedCheque.findUniqueOrThrow({ where: { id: p2.cheque!.id } })).status).toBe("CLEARED");
    expect((await bankBal(bank2.id)) - bal0).toBe(-23_456); // the transfer was booked already; the cheque now
    // Another bank's payment is not offered, and is refused by hand.
    expect((out(1_999).suggestions as { kind: string }[] | null)?.some((s) => s.kind === "SUPPLIER_PAY") ?? false).toBe(false);
    await expect(matchLine(T, adminId, out(1_999).id, { kind: "SUPPLIER_PAY", ref: elsewhere.id })).rejects.toThrow(/another bank account/);

    // A payment nobody entered: the supplier is guessed from the narration.
    const kaveri = out(34_567);
    expect((kaveri.suggestions as { kind: string; supplierId?: string }[]).find((s) => s.kind === "NEW_SUPPLIER_PAYMENT")?.supplierId).toBe(ids.b);
    await expect(matchLine(T, adminId, kaveri.id, { kind: "CASH_DEPOSIT" })).rejects.toThrow(/money coming in/);
    const owedB = await owed(ids.b);
    const m = await matchLine(T, adminId, kaveri.id, { kind: "NEW_SUPPLIER_PAYMENT", supplierId: ids.b });
    const made = await tenantDb(T).supplierPayment.findUniqueOrThrow({ where: { id: m.matchRef! } });
    expect(made).toMatchObject({ method: "BANK", bankAccountId: bank2.id, amount: 34_567, supplierId: ids.b });
    expect(owedB - (await owed(ids.b))).toBe(34_567);
    expect((await bankBal(bank2.id)) - bal0).toBe(-23_456 - 34_567);

    // Money in lands in the statement's bank too.
    await matchLine(T, adminId, lines.find((l) => l.credit === 50_000)!.id, { kind: "CASH_DEPOSIT" });
    expect((await bankBal(bank2.id)) - bal0).toBe(-23_456 - 34_567 + 50_000);

    // A link can be undone and made again; cancelling a payment frees its line.
    expect((await unmatchLine(T, adminId, out(12_345).id)).status).toBe("UNMATCHED");
    expect((await matchLine(T, adminId, out(12_345).id, { kind: "SUPPLIER_PAY", ref: p1.id })).status).toBe("MATCHED");
    await as((ctx) => cancelSupplierPayment(ctx, made.id, "Test only"));
    expect((await tenantDb(T).bankLine.findUniqueOrThrow({ where: { id: kaveri.id } })).status).toBe("UNMATCHED");
    expect((await bankBal(bank2.id)) - bal0).toBe(-23_456 + 50_000);

    // Money out can be set aside and brought back.
    await ignoreLine(T, adminId, out(1_999).id, true, "Not ours");
    expect((await ignoreLine(T, adminId, out(1_999).id, false)).status).toBe("UNMATCHED");
    await as((ctx) => cancelSupplierPayment(ctx, elsewhere.id, "Test only"));
  });
});

describe("payables reports and checks", () => {
  it("shows what we owe as on a day, bill-wise ageing, what falls due, and payments made", async () => {
    const old = await bill(ids.c, 11_000, daysAgo(50)); // due 35 days ago
    const soon = await bill(ids.c, 22_000, daysAgo(10)); // due in 5 days
    const later = await bill(ids.c, 33_000, today); // due in 15 days
    await pay({ supplierId: ids.c, amount: 11_000, billIds: [old.id] });

    const now = await as((ctx) => payablesBySupplier(ctx, today));
    const c = now.rows.find((r) => r.id === ids.c)!;
    expect(c.owed).toBe(await owed(ids.c));
    expect(now.rows.find((r) => r.id === ids.a)?.owed ?? 0).toBe(await owed(ids.a));

    const billsNow = await as((ctx) => openBillsOn(ctx, today, { supplierId: ids.c }));
    expect(billsNow.find((b) => b.id === old.id)).toBeUndefined();
    expect(billsNow.find((b) => b.id === soon.id)).toMatchObject({ left: 22_000, bucket: "notDue" });
    // Yesterday the old bill was still open, 34 days late.
    const billsThen = await as((ctx) => openBillsOn(ctx, daysAgo(1), { supplierId: ids.c }));
    expect(billsThen.find((b) => b.id === old.id)).toMatchObject({ left: 11_000, bucket: "d60", late: 34 });
    expect(billsThen.find((b) => b.id === later.id)).toBeUndefined();

    const due = await as((ctx) => billsFallingDue(ctx, today, 7, { supplierId: ids.c }));
    expect(due.soon.map((b) => b.id)).toContain(soon.id);
    expect(due.soon.map((b) => b.id)).not.toContain(later.id);

    const paid = await as((ctx) => paymentsList(ctx, today, today, { supplierId: ids.b }));
    const live = paid.rows.filter((r) => !r.cancelled);
    expect(paid.totals.paid).toBe(live.reduce((a, r) => a + r.amount, 0));
    expect(paid.totals.tds).toBe(10_000);
    expect(paid.totals.cheque).toBe(23_456);

    const shop = { name: "Test", address: null, gstin: null };
    for (const sheet of [bySupplierSheet(now), billsSheet(billsThen, daysAgo(1)), dueSheet(due), paymentsSheet(paid)]) {
      expect((await renderSheetPdf(sheet, shop)).byteLength).toBeGreaterThan(1000);
    }
    expect(billsCsv(billsThen)[0]).toContain("Days late");
    expect(paymentsCsv(paid)[0]).toContain("TDS section");
    expect(payablesSummary("suppliers", { asOn: today, bySupplier: now })).toContain("We owe suppliers");
    expect(payablesSummary("due", { asOn: today, due })).toContain("Due this week");
  });

  it("keeps the books clean", async () => {
    const c = await as((ctx) => checkBooks(ctx));
    expect(c.results.map((r) => r.key)).toContain("issued-cheques");
    const bad = c.results.filter((r) => !r.ok).map((r) => `${r.key}: ${r.detail}`);
    expect(bad).toEqual([]);
  });
});
