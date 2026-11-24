/**
 * Vouchers (A5) against the real database: payment vouchers (cash, bank, our
 * cheque, staff cash; GST input and TDS), receipt vouchers, contra, journal,
 * staff expenses entered at a handover, cancelling, bank statement lines
 * linked to or entering vouchers, the cash and bank books, the exports and
 * the books check.
 *
 * Runs in the demo tenant with a fresh bank, head and staff member; they are
 * hidden after.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, MoneyError, post, withMoney, type AccountRef, type Ctx } from "@/lib/ledger";
import { checkBooks, createBank, createHead, ensureBooks, todayIst } from "@/lib/books";
import { clearIssuedCheque } from "@/lib/supplier-payments";
import { cancelVoucher, cashBook, cashBookChoices, createVoucher, handoverWithExpenses, voucherDetail, voucherList, voucherOptions, type VoucherInput } from "@/lib/vouchers";
import { cashBookCsv, cashBookSheet, voucherListCsv, voucherListSheet, voucherSheet } from "@/lib/vouchers-export";
import { importStatement, matchLine, unmatchLine } from "@/lib/bank";
import { renderSheetPdf } from "@/lib/dues-export";
import { can } from "@/lib/permissions";

let T = "";
let adminId = "";
const run = Date.now().toString().slice(-6);
const today = todayIst();
const yesterday = new Date(Date.now() - 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e) => (e instanceof MoneyError ? e.status : -1),
  );
const msg = async (p: Promise<unknown>) =>
  p.then(
    () => "",
    (e) => (e as Error).message,
  );
const ids = { bank2: "", bank2Code: "", mainCode: "", rent: "", fuel: "", loading: "", interest: "", capital: "", petty: "", furniture: "", staff: "" };
const bal = (ref: AccountRef) => as((ctx) => balanceOf(ctx, ref));
const head = (id: string) => bal({ type: "HEAD", headId: id });
const pv = (over: Partial<VoucherInput> = {}) => as((ctx) => createVoucher(ctx, { type: "PAYMENT", date: today, method: "CASH", lines: [{ code: `HEAD:${ids.rent}`, amount: 100_00 }], ...over }));
const slip = (n: number) => `t/${T}/voucher-slip/2026/11/test-${run}-${n}.jpg`;

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true } });
  T = demo.id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await as((ctx) => ensureBooks(ctx));
  const b2 = await as((ctx) => createBank(ctx, { name: `Test voucher bank ${run}` }));
  ids.bank2 = b2.id;
  ids.bank2Code = b2.ledgerCode;
  ids.mainCode = (await db.bankAccount.findFirstOrThrow({ where: { isDefault: true } })).ledgerCode;
  const key = async (k: string) => (await db.ledgerHead.findFirstOrThrow({ where: { key: k } })).id;
  ids.rent = await key("rent");
  ids.fuel = await key("fuel");
  ids.loading = await key("loading");
  ids.interest = await key("interest_received");
  ids.capital = await key("capital");
  ids.petty = await key("petty_cash");
  ids.furniture = await key("furniture");
  // Heads may have been hidden by an earlier run's clean-up of "Test" heads; these are starter heads, so show them.
  await db.ledgerHead.updateMany({ where: { id: { in: [ids.rent, ids.fuel, ids.loading, ids.interest, ids.capital, ids.petty, ids.furniture] } }, data: { active: true } });
  ids.staff = (await db.user.create({ data: { name: `Test voucher driver ${run}`, loginId: `vdrv${run}`, passwordHash: "x", role: "DELIVERY_AGENT" } })).id;
  // Office cash to spend from in these tests.
  await as((ctx) =>
    post(ctx, {
      kind: "OPENING",
      memo: `Test vouchers float ${run}`,
      lines: [
        { account: { type: "OFFICE_CASH" }, amount: 50_000_00 },
        { account: { type: "OPENING_EQUITY" }, amount: -50_000_00 },
      ],
    }),
  );
});

afterAll(async () => {
  const db = tenantDb(T);
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await db.bankAccount.updateMany({ where: { id: ids.bank2 }, data: { active: false } });
  await db.user.updateMany({ where: { id: ids.staff }, data: { active: false } });
});

describe("payment vouchers", () => {
  it("lets the accountant enter vouchers, not the sales agent", () => {
    expect(can("ACCOUNTANT", "accounts.post")).toBe(true);
    expect(can("SALES_AGENT", "accounts.post")).toBe(false);
    expect(can("DELIVERY_AGENT", "accounts.post")).toBe(false);
  });

  it("posts Dr heads + GST input, Cr cash + TDS payable, numbered PV<fy>, lines kept as posted", async () => {
    const [rent0, cash0, gst0, tds0] = await Promise.all([head(ids.rent), bal({ type: "OFFICE_CASH" }), bal({ type: "GST_INPUT" }), bal({ type: "TDS_PAYABLE" })]);
    const v = await pv({
      lines: [
        { code: `HEAD:${ids.rent}`, amount: 10_000_00, note: "November" },
        { code: `HEAD:${ids.fuel}`, amount: 500_00 },
      ],
      party: "Sharma Properties",
      partyGstin: "27AAPFU0939F1ZV",
      gst: 1_800_00,
      tds: 1_000_00,
      tdsSection: "194i",
      reference: "Bill 77",
    });
    expect(v.number).toMatch(/^PV\d{4}-\d{5}$/);
    expect(v.amount).toBe(10_000_00 + 500_00 + 1_800_00 - 1_000_00);
    expect(v.tdsSection).toBe("194I");
    expect(v.lines.map((l) => [l.role, l.amount])).toEqual([
      ["ACCOUNT", 10_000_00],
      ["ACCOUNT", 500_00],
      ["GST", 1_800_00],
      ["TDS", -1_000_00],
      ["MONEY", -11_300_00],
    ]);
    expect((await head(ids.rent)) - rent0).toBe(10_000_00);
    expect((await bal({ type: "OFFICE_CASH" })) - cash0).toBe(-11_300_00);
    expect((await bal({ type: "GST_INPUT" })) - gst0).toBe(1_800_00);
    expect((await bal({ type: "TDS_PAYABLE" })) - tds0).toBe(-1_000_00);
    const e = await tenantDb(T).journalEntry.findUniqueOrThrow({ where: { id: v.entryId! } });
    expect(e.kind).toBe("VOUCHER_PAYMENT");
    expect(e.memo).toContain(v.number);
  });

  it("refuses what isn't a payment", async () => {
    expect(await msg(pv({ lines: [{ code: `HEAD:${ids.petty}`, amount: 100 }] }))).toMatch(/contra/);
    expect(await msg(pv({ lines: [{ code: ids.bank2Code, amount: 100 }] }))).toMatch(/contra/);
    expect(await msg(pv({ lines: [{ code: "GST_INPUT", amount: 100 }] }))).toMatch(/heads/);
    expect(await msg(pv({ lines: [{ code: "SALES", amount: 100 }] }))).toMatch(/own bills/);
    expect(await msg(pv({ gst: 18_00 }))).toMatch(/GSTIN/);
    expect(await msg(pv({ partyGstin: "27ABC" }))).toMatch(/GSTIN/);
    expect(await msg(pv({ tds: 200_00, tdsSection: "194C" }))).toMatch(/TDS is more/);
    expect(await msg(pv({ tds: 10_00 }))).toMatch(/section/);
    expect(await msg(pv({ date: "2099-01-01" }))).toMatch(/future/);
    expect(await msg(pv({ lines: [] }))).toMatch(/Add a line/);
    expect(await msg(pv({ method: "CASH", cashCode: ids.bank2Code }))).toMatch(/cash head/);
    expect(await msg(as((ctx) => createVoucher(ctx, { type: "RECEIPT", date: today, method: "CHEQUE", lines: [{ code: `HEAD:${ids.capital}`, amount: 100 }] })))).toMatch(/cash or a bank/);
    expect(await msg(pv({ photos: [`t/someone-else/voucher-slip/x.jpg`] }))).toMatch(/not one of ours/);
    expect(await msg(pv({ photos: [`t/${T}/selfie/x.jpg`] }))).toMatch(/not one of ours/);
  });

  it("pays by our cheque: issued until the bank pays it; a cleared cheque's voucher stands", async () => {
    const no = `7${run}`;
    const v = await pv({ method: "CHEQUE", bankAccountId: ids.bank2, party: "Gupta Furniture", cheque: { number: no }, lines: [{ code: `HEAD:${ids.furniture}`, amount: 2_500_00 }] });
    const ch = await tenantDb(T).issuedCheque.findUniqueOrThrow({ where: { id: v.chequeId! } });
    expect(ch).toMatchObject({ status: "ISSUED", amount: 2_500_00, payee: "Gupta Furniture", bankAccountId: ids.bank2, supplierId: null });
    expect(v.lines.find((l) => l.role === "MONEY")?.code).toBe("ISSUED_CHEQUES");
    expect(await msg(pv({ method: "CHEQUE", bankAccountId: ids.bank2, cheque: { number: `9${run}` } }))).toMatch(/who the cheque is to/);
    expect(await code(pv({ method: "CHEQUE", bankAccountId: ids.bank2, party: "X", cheque: { number: no } }))).toBe(409);

    const b0 = await bal({ type: "BANK", bankAccountId: ids.bank2 });
    await as((ctx) => clearIssuedCheque(ctx, ch.id));
    expect((await bal({ type: "BANK", bankAccountId: ids.bank2 })) - b0).toBe(-2_500_00);
    expect(await code(as((ctx) => cancelVoucher(ctx, v.id, "Wrong amount")))).toBe(409);

    // An uncleared cheque's voucher can be cancelled: the cheque is cancelled with it.
    const v2 = await pv({ method: "CHEQUE", bankAccountId: ids.bank2, party: "Gupta Furniture", cheque: { number: `8${run}` }, lines: [{ code: `HEAD:${ids.furniture}`, amount: 300_00 }] });
    const f0 = await head(ids.furniture);
    await as((ctx) => cancelVoucher(ctx, v2.id, "Cheque torn up"));
    expect((await tenantDb(T).issuedCheque.findUniqueOrThrow({ where: { id: v2.chequeId! } })).status).toBe("CANCELLED");
    expect((await head(ids.furniture)) - f0).toBe(-300_00);
    expect(await code(as((ctx) => cancelVoucher(ctx, v2.id, "Again")))).toBe(409);
  });

  it("respects the books lock", async () => {
    await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: new Date(`${yesterday}T00:00:00Z`) } });
    try {
      expect(await code(pv({ date: yesterday }))).toBe(409);
    } finally {
      await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
    }
  });
});

describe("receipts, contra and journal", () => {
  it("receives money with TDS deducted by the payer: Dr bank + TDS deducted, Cr head", async () => {
    const [b0, i0, t0] = await Promise.all([bal({ type: "BANK", bankAccountId: ids.bank2 }), head(ids.interest), bal({ type: "TDS_RECEIVABLE" })]);
    const v = await as((ctx) =>
      createVoucher(ctx, {
        type: "RECEIPT",
        date: today,
        method: "BANK",
        bankAccountId: ids.bank2,
        party: "Bank FD",
        lines: [{ code: `HEAD:${ids.interest}`, amount: 1_000_00 }],
        tds: 100_00,
        tdsSection: "194A",
      }),
    );
    expect(v.number).toMatch(/^RV/);
    expect(v.amount).toBe(900_00);
    expect((await bal({ type: "BANK", bankAccountId: ids.bank2 })) - b0).toBe(900_00);
    expect((await head(ids.interest)) - i0).toBe(-1_000_00);
    expect((await bal({ type: "TDS_RECEIVABLE" })) - t0).toBe(100_00);
  });

  it("moves money between cash and banks, never to the same place or a head", async () => {
    const [c0, b0] = await Promise.all([bal({ type: "OFFICE_CASH" }), bal({ type: "BANK", bankAccountId: ids.bank2 })]);
    const v = await as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: "OFFICE_CASH", toCode: ids.bank2Code, amount: 5_000_00 }));
    expect(v.number).toMatch(/^CV/);
    expect(v.bankAccountId).toBe(ids.bank2);
    expect((await bal({ type: "OFFICE_CASH" })) - c0).toBe(-5_000_00);
    expect((await bal({ type: "BANK", bankAccountId: ids.bank2 })) - b0).toBe(5_000_00);
    expect(await msg(as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: "OFFICE_CASH", toCode: "OFFICE_CASH", amount: 1 })))).toMatch(/two different/);
    expect(await msg(as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: "OFFICE_CASH", toCode: `HEAD:${ids.rent}`, amount: 1 })))).toMatch(/into cash or a bank/);
    expect(await msg(as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: "OFFICE_CASH", toCode: `STAFF_CASH:${ids.staff}`, amount: 1 })))).toMatch(/into cash or a bank/);
    // Petty cash topped up from office cash.
    const p0 = await head(ids.petty);
    await as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: "OFFICE_CASH", toCode: `HEAD:${ids.petty}`, amount: 200_00 }));
    expect((await head(ids.petty)) - p0).toBe(200_00);
  });

  it("posts a balanced journal with a reason, only to accounts not kept by their own bills", async () => {
    const jv = (lines: VoucherInput["lines"], narration: string | null = "Depreciation for the half year") => as((ctx) => createVoucher(ctx, { type: "JOURNAL", date: today, lines, narration }));
    const dep = await tenantDb(T).ledgerHead.findFirst({ where: { name: `Test depreciation ${run}` } });
    const depId = dep?.id ?? (await as((ctx) => createHead(ctx, { name: `Test depreciation ${run}`, group: "INDIRECT_EXPENSES" }))).id;
    const f0 = await head(ids.furniture);
    const v = await jv([
      { code: `HEAD:${depId}`, amount: 1_250_00 },
      { code: `HEAD:${ids.furniture}`, amount: -1_250_00 },
    ]);
    expect(v.number).toMatch(/^JV/);
    expect(v.amount).toBe(1_250_00);
    expect((await head(ids.furniture)) - f0).toBe(-1_250_00);
    expect(
      await msg(
        jv([
          { code: `HEAD:${depId}`, amount: 100 },
          { code: `HEAD:${ids.furniture}`, amount: -99 },
        ]),
      ),
    ).toMatch(/must be equal/);
    expect(
      await msg(
        jv(
          [
            { code: `HEAD:${depId}`, amount: 100 },
            { code: `HEAD:${ids.furniture}`, amount: -100 },
          ],
          null,
        ),
      ),
    ).toMatch(/reason/);
    expect(await msg(jv([{ code: `HEAD:${depId}`, amount: 100 }]))).toMatch(/two lines/);
    const shop = await tenantDb(T).retailerProfile.findFirstOrThrow({ select: { id: true } });
    expect(
      await msg(
        jv([
          { code: `RECEIVABLE:${shop.id}`, amount: 100 },
          { code: `HEAD:${depId}`, amount: -100 },
        ]),
      ),
    ).toMatch(/own bills/);
    expect(
      await msg(
        jv([
          { code: "SALES", amount: 100 },
          { code: `HEAD:${depId}`, amount: -100 },
        ]),
      ),
    ).toMatch(/own bills/);
    expect(
      await msg(
        jv([
          { code: `STAFF_CASH:${ids.staff}`, amount: 100 },
          { code: `HEAD:${depId}`, amount: -100 },
        ]),
      ),
    ).toMatch(/handovers/);
    // Built-ins such as rounding and TDS may take a journal line.
    const r = await jv(
      [
        { code: "ROUND_OFF", amount: 1 },
        { code: "TDS_PAYABLE", amount: -1 },
      ],
      "Rounding on TDS paid",
    );
    expect(r.lines.map((l) => l.code)).toEqual(["ROUND_OFF", "TDS_PAYABLE"]);
    await as((ctx) => cancelVoucher(ctx, r.id, "Test only"));
    // A hidden head takes no new lines.
    await tenantDb(T).ledgerHead.update({ where: { id: depId }, data: { active: false } });
    expect(
      await msg(
        jv([
          { code: `HEAD:${depId}`, amount: 100 },
          { code: `HEAD:${ids.furniture}`, amount: -100 },
        ]),
      ),
    ).toMatch(/hidden/);
  });
});

describe("staff expenses at a handover", () => {
  it("takes the expenses off their cash first, so short is only the real shortage", async () => {
    await as((ctx) =>
      post(ctx, {
        kind: "OPENING",
        memo: "Test collected cash",
        lines: [
          { account: { type: "STAFF_CASH", userId: ids.staff }, amount: 5_000_00 },
          { account: { type: "OFFICE_CASH" }, amount: -5_000_00 },
        ],
      }),
    );
    const fuel0 = await head(ids.fuel);
    const r = await as((ctx) =>
      handoverWithExpenses(ctx, {
        staffUserId: ids.staff,
        counted: 3_500_00,
        expenses: [
          { headId: ids.fuel, amount: 900_00, note: "Diesel" },
          { headId: ids.loading, amount: 300_00 },
        ],
        photos: [slip(1)],
      }),
    );
    expect(r.voucher).toMatchObject({ type: "PAYMENT", method: "STAFF", staffUserId: ids.staff, amount: 1_200_00, photos: [slip(1)] });
    expect(r.handover).toMatchObject({ expected: 3_800_00, counted: 3_500_00, variance: 300_00, expenses: 1_200_00 });
    expect((await tenantDb(T).voucher.findUniqueOrThrow({ where: { id: r.voucher!.id } })).handoverId).toBe(r.handover.id);
    expect((await head(ids.fuel)) - fuel0).toBe(900_00);
    expect(await bal({ type: "STAFF_CASH", userId: ids.staff })).toBe(300_00);

    // More than they hold is refused; a slip with no expense too.
    expect(await msg(as((ctx) => handoverWithExpenses(ctx, { staffUserId: ids.staff, counted: 0, expenses: [{ headId: ids.fuel, amount: 400_00 }] })))).toMatch(/holds only/);
    expect(await msg(as((ctx) => handoverWithExpenses(ctx, { staffUserId: ids.staff, counted: 0, photos: [slip(2)] })))).toMatch(/expense/);

    // Cancelling the expense puts the money back on their cash in hand.
    await as((ctx) => cancelVoucher(ctx, r.voucher!.id, "Fuel was paid by the office"));
    expect(await bal({ type: "STAFF_CASH", userId: ids.staff })).toBe(1_500_00);
    expect((await tenantDb(T).cashHandover.findUniqueOrThrow({ where: { id: r.handover.id } })).expenses).toBe(0);

    // Staff cash can go straight to the bank as a contra (they deposited it).
    const v = await as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: `STAFF_CASH:${ids.staff}`, toCode: ids.bank2Code, amount: 1_500_00 }));
    expect(v.staffUserId).toBe(ids.staff);
    expect(await bal({ type: "STAFF_CASH", userId: ids.staff })).toBe(0);
    expect(await msg(as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: `STAFF_CASH:${ids.staff}`, toCode: ids.bank2Code, amount: 1 })))).toMatch(/holds only/);
  });
});

describe("bank statement and vouchers", () => {
  it("links vouchers already entered, enters new ones from a line, and frees a line when its voucher is cancelled", async () => {
    const utr = `UTRV${run}11`;
    const rent = await pv({ method: "BANK", bankAccountId: ids.bank2, reference: utr, party: "Landlord", lines: [{ code: `HEAD:${ids.rent}`, amount: 12_000_00 }] });
    const move = await as((ctx) => createVoucher(ctx, { type: "CONTRA", date: today, fromCode: ids.bank2Code, toCode: ids.mainCode, amount: 777_00, reference: `TRF${run}` }));
    const csv = [
      "Date,Narration,Ref No,Debit,Credit,Balance",
      `${today},NEFT/${utr}/landlord ${run},,12000.00,,`,
      `${today},SMS ALERT CHGS QTR ${run},,17.70,,`,
      `${today},ATM WDL ${run} SECTOR 4,,2000.00,,`,
      `${today},BY CASH DEPOSIT CDM ${run},,,3000.00,`,
      `${today},SB INT PD ${run},,,45.10,`,
      `${today},TRF${run} TO OWN AC,,777.00,,99999.00`,
    ].join("\n");
    const r = await importStatement(T, adminId, { fileName: `vouchers-${run}.csv`, bankAccountId: ids.bank2, bytes: Buffer.from(csv) });
    const lines = await tenantDb(T).bankLine.findMany({ where: { statementId: r.statement.id } });
    const out = (d: number) => lines.find((l) => l.debit === d)!;
    const inn = (c: number) => lines.find((l) => l.credit === c)!;
    const kinds = (l: { suggestions: unknown }) => (l.suggestions as { kind: string; headId?: string; otherCode?: string }[] | null) ?? [];
    expect(out(12_000_00)).toMatchObject({ status: "MATCHED", matchKind: "VOUCHER_OUT", matchRef: rent.id });
    expect(out(777_00)).toMatchObject({ status: "MATCHED", matchKind: "VOUCHER_OUT", matchRef: move.id });
    expect(kinds(out(17_70)).find((s) => s.kind === "NEW_EXPENSE")?.headId).toBeTruthy();
    expect(kinds(out(2_000_00)).find((s) => s.kind === "NEW_CONTRA")?.otherCode).toBe("OFFICE_CASH");
    expect(kinds(inn(3_000_00)).some((s) => s.kind === "CASH_DEPOSIT")).toBe(true);
    expect(kinds(inn(45_10)).find((s) => s.kind === "NEW_RECEIPT")?.headId).toBe(ids.interest);

    const [b0, c0] = await Promise.all([bal({ type: "BANK", bankAccountId: ids.bank2 }), bal({ type: "OFFICE_CASH" })]);
    const charges = kinds(out(17_70)).find((s) => s.kind === "NEW_EXPENSE")!;
    const m1 = await matchLine(T, adminId, out(17_70).id, { kind: "NEW_EXPENSE", headId: charges.headId });
    const made = await tenantDb(T).voucher.findUniqueOrThrow({ where: { id: m1.matchRef! }, include: { lines: true } });
    expect(made).toMatchObject({ type: "PAYMENT", method: "BANK", bankAccountId: ids.bank2, amount: 17_70 });
    expect(m1.entryId).toBe(made.entryId);
    await matchLine(T, adminId, out(2_000_00).id, { kind: "NEW_CONTRA", otherCode: "OFFICE_CASH" });
    const dep = await matchLine(T, adminId, inn(3_000_00).id, { kind: "CASH_DEPOSIT" });
    expect((await tenantDb(T).voucher.findUniqueOrThrow({ where: { id: dep.matchRef! } })).type).toBe("CONTRA");
    await matchLine(T, adminId, inn(45_10).id, { kind: "NEW_RECEIPT", headId: ids.interest });
    expect((await bal({ type: "BANK", bankAccountId: ids.bank2 })) - b0).toBe(-17_70 - 2_000_00 + 3_000_00 + 45_10);
    expect((await bal({ type: "OFFICE_CASH" })) - c0).toBe(2_000_00 - 3_000_00);

    // Direction and bank are checked; a voucher leg matches one line only.
    expect(await msg(matchLine(T, adminId, inn(45_10).id, { kind: "NEW_EXPENSE", headId: ids.rent }))).toMatch(/already matched/);
    const m2 = await tenantDb(T).bankLine.findFirstOrThrow({ where: { id: out(12_000_00).id } });
    expect(m2.status).toBe("MATCHED");

    // The other side of the bank-to-bank move, on the main bank's statement.
    const r2 = await importStatement(T, adminId, {
      fileName: `main-${run}.csv`,
      bytes: Buffer.from(["Date,Narration,Ref No,Debit,Credit,Balance", `${today},TRF${run} FROM OWN AC,,,777.00,`].join("\n")),
    });
    const back = await tenantDb(T).bankLine.findFirstOrThrow({ where: { statementId: r2.statement.id } });
    expect(back).toMatchObject({ status: "MATCHED", matchKind: "VOUCHER_IN", matchRef: move.id });

    // A link can be undone; a line that entered a voucher is undone by cancelling the voucher.
    expect((await unmatchLine(T, adminId, out(12_000_00).id)).status).toBe("UNMATCHED");
    expect(await msg(matchLine(T, adminId, out(12_000_00).id, { kind: "VOUCHER_OUT", ref: move.id }))).toMatch(/₹/);
    expect((await matchLine(T, adminId, out(12_000_00).id, { kind: "VOUCHER_OUT", ref: rent.id })).status).toBe("MATCHED");
    expect(await msg(unmatchLine(T, adminId, out(17_70).id))).toMatch(/cancel the voucher/);
    await as((ctx) => cancelVoucher(ctx, made.id, "Bank reversed the charge"));
    expect((await tenantDb(T).bankLine.findUniqueOrThrow({ where: { id: out(17_70).id } })).status).toBe("UNMATCHED");

    // The bank book marks what the statement has shown, and sets its balance beside ours.
    const book = await as((ctx) => cashBook(ctx, ids.bank2Code, today, today));
    expect(book.kind).toBe("bank");
    const rows = book.days.flatMap((d) => d.rows);
    expect(rows.find((x) => x.memo?.includes(rent.number))?.inBank).toBe(true);
    expect(rows.find((x) => x.memo?.includes(rent.number))?.href).toBe(`/admin/books/vouchers/${rent.id}`);
    expect(book.recon?.statementBalance).toBe(99_999_00);
    expect(book.recon?.unmatchedLines).toBe(1);
    expect(book.days.at(-1)?.closing).toBe(book.closing);
  });
});

describe("reading and exports", () => {
  it("lists vouchers with totals, shows one, and makes the cash book and PDFs", async () => {
    const opts = await as((ctx) => voucherOptions(ctx));
    expect(opts.heads.some((h) => h.code === `HEAD:${ids.rent}`)).toBe(true);
    expect(opts.heads.some((h) => h.code === `HEAD:${ids.petty}`)).toBe(false);
    expect(opts.cash.map((c) => c.code)).toContain(`HEAD:${ids.petty}`);
    expect(opts.journal.some((j) => j.code === "SALES")).toBe(false);
    const choices = await as((ctx) => cashBookChoices(ctx));
    expect(choices.banks.some((b) => b.code === ids.bank2Code)).toBe(true);

    const l = await as((ctx) => voucherList(ctx, today, today, {}));
    expect(l.counts.PAYMENT).toBeGreaterThan(0);
    expect(l.rows.some((r) => r.cancelled)).toBe(true);
    const onlyRent = await as((ctx) => voucherList(ctx, today, today, { q: "Landlord" }));
    expect(onlyRent.rows.every((r) => r.party === "Landlord")).toBe(true);
    const contra = await as((ctx) => voucherList(ctx, today, today, { type: "CONTRA" }));
    expect(contra.rows.every((r) => r.type === "CONTRA" && r.what.includes("→"))).toBe(true);

    const d = await as((ctx) => voucherDetail(ctx, onlyRent.rows[0].id));
    expect(d.bankLines).toHaveLength(1);
    expect(d.typeLabel).toBe("Payment voucher");

    const book = await as((ctx) => cashBook(ctx, "OFFICE_CASH", today, today));
    expect(book.kind).toBe("cash");
    expect(book.recon).toBeNull();
    expect(book.days.length).toBe(1);
    expect(await code(as((ctx) => cashBook(ctx, `HEAD:${ids.rent}`, today, today)))).toBe(400);

    const tenant = { name: "Test", address: null, gstin: null };
    expect((await renderSheetPdf(voucherListSheet(l), tenant)).byteLength).toBeGreaterThan(1000);
    expect((await renderSheetPdf(voucherSheet(d, tenant), tenant)).byteLength).toBeGreaterThan(1000);
    expect((await renderSheetPdf(cashBookSheet(book), tenant)).byteLength).toBeGreaterThan(1000);
    expect(voucherListCsv(l)[0][1]).toBe("Number");
    expect(cashBookCsv(book).at(-1)?.[2]).toBe("Closing balance");
  });

  it("keeps the books clean: vouchers agree with the ledger, no cash below zero", async () => {
    const r = await as((ctx) => checkBooks(ctx));
    expect(r.results.filter((x) => !x.ok)).toEqual([]);
    expect(r.results.find((x) => x.key === "vouchers")?.ok).toBe(true);
    expect(r.results.find((x) => x.key === "cash")?.ok).toBe(true);
  });
});
