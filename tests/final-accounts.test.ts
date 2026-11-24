/**
 * Final accounts (A7) against the real database: trial balance for a period,
 * profit and loss (with stock, months and last year), balance sheet, opening
 * the books, year end, the owner's figures and the CA pack.
 *
 * Runs in the demo tenant. P&L figures are checked as differences before and
 * after posting test entries dated in FY 2004-05 (no other test uses it), so
 * earlier runs don't matter; the entries are reversed on their own dates
 * after. The opening balances and the tenant's opening fields are put back.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { MoneyError, post, reverseEntry, withMoney, type Ctx } from "@/lib/ledger";
import { chartOfAccounts, checkBooks, dayEnd, ensureBooks, todayIst } from "@/lib/books";
import { addDay, balanceSheet, fyEnd, openingView, ownerFigures, profitAndLoss, saveOpening, shiftYear, trialBalance, yearEnd } from "@/lib/final-accounts";
import { bsCsv, bsSheet, caPack, plCsv, plMonthsSheet, plSheet, tbCsv, tbSheet } from "@/lib/final-accounts-export";
import { renderSheetPdf } from "@/lib/dues-export";
import { crc32, zip } from "@/lib/zip";

let T = "";
let adminId = "";
const today = todayIst();
const as = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const code = async (p: Promise<unknown>) =>
  p.then(
    () => 0,
    (e) => (e instanceof MoneyError ? e.status : -1),
  );
const ids = { rent: "", loading: "", interest: "", capital: "", furniture: "" };
const posted: { id: string; at: Date }[] = [];
let saved: { booksStartOn: Date | null; openingStock: bigint | null; openingEntryId: string | null } = { booksStartOn: null, openingStock: null, openingEntryId: null };
const FROM = "2004-04-01";
const TO = "2005-03-31";
const AT = dayEnd("2004-06-10");

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, booksStartOn: true, openingStock: true, openingEntryId: true } });
  T = demo.id;
  saved = { booksStartOn: demo.booksStartOn, openingStock: demo.openingStock, openingEntryId: demo.openingEntryId };
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  await as((ctx) => ensureBooks(ctx));
  const key = async (k: string) => (await db.ledgerHead.findFirstOrThrow({ where: { key: k } })).id;
  ids.rent = await key("rent");
  ids.loading = await key("loading");
  ids.interest = await key("interest_received");
  ids.capital = await key("capital");
  ids.furniture = await key("furniture");
  await db.ledgerHead.updateMany({ where: { id: { in: Object.values(ids) } }, data: { active: true } });
});

afterAll(async () => {
  await as(async (ctx) => {
    for (const p of posted) {
      const e = await ctx.tx.journalEntry.findUnique({ where: { id: p.id }, select: { reversedBy: { select: { id: true } } } });
      if (e && !e.reversedBy) await reverseEntry(ctx, p.id, "Test clean-up", p.at);
    }
  });
  await prisma.tenant.update({ where: { id: T }, data: saved });
});

describe("trial balance", () => {
  it("agrees, and its closing equals the chart of accounts", async () => {
    const tb = await as((ctx) => trialBalance(ctx, addDay(today, -60), today));
    expect(tb.difference).toBe(0);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.openingDr).toBe(tb.totals.openingCr);
    const chart = await as((ctx) => chartOfAccounts(ctx, today));
    expect(tb.totals.closingDr).toBe(chart.debit);
    for (const g of tb.groups) for (const r of g.rows) expect(r.closing).toBe(r.opening + r.debit - r.credit);
    const sheet = tbSheet(tb);
    expect(sheet.rows.length).toBeGreaterThan(3);
    expect(tbCsv(tb)[0]).toEqual(["Group", "Account", "Accounts", "Opening", "Debit", "Credit", "Closing"]);
  });

  it("refuses bad periods", async () => {
    expect(await code(as((ctx) => trialBalance(ctx, today, addDay(today, -1))))).toBe(400);
    expect(await code(as((ctx) => trialBalance(ctx, "2020-01-01", "2022-01-01")))).toBe(400);
  });
});

describe("profit and loss", () => {
  it("adds sales, returns, purchases, direct and running costs, other income into gross and net profit", async () => {
    const before = await as((ctx) => profitAndLoss(ctx, FROM, TO, { months: true }));
    await as(async (ctx) => {
      const e = (lines: Parameters<typeof post>[1]["lines"], memo: string) => post(ctx, { kind: "JOURNAL", memo, occurredAt: AT, lines }).then((x) => posted.push({ id: x.id, at: AT }));
      await e(
        [
          { account: { type: "OFFICE_CASH" }, amount: 10_000_00 },
          { account: { type: "SALES" }, amount: -10_000_00 },
        ],
        "Test sale",
      );
      await e(
        [
          { account: { type: "SALES" }, amount: 1_000_00 },
          { account: { type: "OFFICE_CASH" }, amount: -1_000_00 },
        ],
        "Test return",
      );
      await e(
        [
          { account: { type: "PURCHASES" }, amount: 6_000_00 },
          { account: { type: "OFFICE_CASH" }, amount: -6_000_00 },
        ],
        "Test purchase",
      );
      await e(
        [
          { account: { type: "HEAD", headId: ids.loading }, amount: 500_00 },
          { account: { type: "OFFICE_CASH" }, amount: -500_00 },
        ],
        "Test loading",
      );
      await e(
        [
          { account: { type: "HEAD", headId: ids.rent }, amount: 1_000_00 },
          { account: { type: "OFFICE_CASH" }, amount: -1_000_00 },
        ],
        "Test rent",
      );
      await e(
        [
          { account: { type: "OFFICE_CASH" }, amount: 300_00 },
          { account: { type: "HEAD", headId: ids.interest }, amount: -300_00 },
        ],
        "Test interest",
      );
    });
    const after = await as((ctx) => profitAndLoss(ctx, FROM, TO, { months: true, compare: true }));
    expect(after.sales.gross - before.sales.gross).toBe(10_000_00);
    expect(after.sales.returns - before.sales.returns).toBe(1_000_00);
    expect(after.purchases.total - before.purchases.total).toBe(6_000_00);
    expect(after.direct.total - before.direct.total).toBe(500_00);
    expect(after.indirect.total - before.indirect.total).toBe(1_000_00);
    expect(after.otherIncome.total - before.otherIncome.total).toBe(300_00);
    expect(after.openingStock).toBe(before.openingStock);
    expect(after.closingStock).toBe(before.closingStock);
    expect(after.grossProfit - before.grossProfit).toBe(10_000_00 - 1_000_00 - 6_000_00 - 500_00);
    expect(after.netProfit - before.netProfit).toBe(1_800_00);
    expect(after.grossProfit).toBe(after.sales.net - (after.openingStock + after.purchases.total - after.closingStock) - after.direct.total);
    expect(after.netProfit).toBe(after.grossProfit - after.indirect.total + after.otherIncome.total);

    // Months: twelve, June carries the change, and they add up to the year.
    expect(after.months).toHaveLength(12);
    const june = (p: typeof after) => p.months!.find((m) => m.month === "2004-06")!;
    expect(june(after).netProfit - june(before).netProfit).toBe(1_800_00);
    expect(after.months!.reduce((a, m) => a + m.netProfit, 0)).toBe(after.netProfit);
    expect(after.months![11].closingStock).toBe(after.closingStock);

    const sheet = plSheet(after);
    expect(sheet.rows.some((r) => r.kind === "total")).toBe(true);
    expect(plMonthsSheet(after).rows).toHaveLength(13);
    expect(plCsv(after).length).toBeGreaterThan(10);
    await renderSheetPdf(sheet, { name: "Test" });
  });

  it("compares with the same period last year when there is one", async () => {
    const p = await as((ctx) => profitAndLoss(ctx, shiftYear(FROM, 1), shiftYear(TO, 1), { compare: true }));
    expect(p.lastYear?.from).toBe(FROM);
    expect(p.lastYear?.to).toBe(TO);
    expect(shiftYear("2024-02-29", 1)).toBe("2025-02-28");
  });
});

describe("balance sheet", () => {
  it("balances today and at the end of the test year, with profit under capital", async () => {
    for (const day of [today, TO]) {
      const bs = await as((ctx) => balanceSheet(ctx, day));
      expect(bs.difference).toBe(0);
      expect(bs.totalAssets).toBe(bs.totalLiabilities);
      const capital = bs.liabilities.find((s) => s.key === "capital")!;
      expect(capital.lines.some((l) => l.key === "pl-year")).toBe(true);
      expect(bsSheet(bs).rows.length).toBeGreaterThan(4);
      expect(bsCsv(bs).length).toBeGreaterThan(3);
    }
    // This year's profit on the balance sheet is the P&L's.
    const bs = await as((ctx) => balanceSheet(ctx, TO));
    const pl = await as((ctx) => profitAndLoss(ctx, bs.profit.from, TO));
    expect(bs.profit.thisYear).toBe(pl.netProfit);
  });
});

describe("opening the books", () => {
  it("posts the opening trial balance the day before the start, replaces it on saving again, and tells whether it agrees", async () => {
    const start = "2003-04-01";
    const v0 = await as((ctx) => openingView(ctx));
    expect(v0.accounts.some((a) => a.code === "OFFICE_CASH")).toBe(true);
    expect(v0.accounts.some((a) => a.code === `HEAD:${ids.capital}`)).toBe(true);

    // Furniture 20,000 Dr, capital 70,000 Cr, stock 50,000: agrees by itself.
    const v1 = await as((ctx) =>
      saveOpening(ctx, {
        startOn: start,
        openingStock: 50_000_00,
        lines: [
          { code: `HEAD:${ids.furniture}`, amount: 20_000_00 },
          { code: `HEAD:${ids.capital}`, amount: -70_000_00 },
        ],
      }),
    );
    expect(v1.startOn).toBe(start);
    expect(v1.openingStock).toBe(50_000_00);
    expect(v1.enteredAt).toBe("2003-03-31");
    expect(v1.accounts.find((a) => a.code === `HEAD:${ids.furniture}`)?.amount).toBe(20_000_00);
    // Furniture + stock = capital, so it changes nothing but the old stock figure (difference = opening balances − stock).
    if (!v0.enteredAt) expect(v1.difference - v0.difference).toBe(v0.openingStock ?? 0);
    const t1 = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { openingEntryId: true } });
    const e1 = await tenantDb(T).journalEntry.findUniqueOrThrow({ where: { id: t1.openingEntryId! }, include: { lines: { include: { account: { select: { code: true } } } } } });
    expect(e1.kind).toBe("OPENING");
    expect(e1.occurredAt.toISOString()).toBe(dayEnd("2003-03-31").toISOString());
    const eq = e1.lines.filter((l) => l.account.code === "OPENING_EQUITY").reduce((a, l) => a + l.amount, 0);
    expect(eq).toBe(50_000_00);

    // Saving again reverses the first on its own date.
    const v2 = await as((ctx) =>
      saveOpening(ctx, {
        startOn: start,
        openingStock: 50_000_00,
        lines: [
          { code: `HEAD:${ids.furniture}`, amount: 25_000_00 },
          { code: `HEAD:${ids.capital}`, amount: -70_000_00 },
        ],
      }),
    );
    expect(v2.accounts.find((a) => a.code === `HEAD:${ids.furniture}`)?.amount).toBe(25_000_00);
    expect(v2.difference - v1.difference).toBe(-5_000_00);
    const rev = await tenantDb(T).journalEntry.findFirstOrThrow({ where: { reversesId: e1.id } });
    expect(rev.occurredAt.toISOString()).toBe(e1.occurredAt.toISOString());

    // The first year's P&L opens with the opening stock.
    const pl = await as((ctx) => profitAndLoss(ctx, start, "2003-06-30"));
    expect(pl.openingStock).toBe(50_000_00);
    expect(pl.openingStockFrom).toBe("opening");

    // Shops' and suppliers' accounts are not entered here; the future is refused.
    expect(await code(as((ctx) => saveOpening(ctx, { startOn: start, openingStock: null, lines: [{ code: "SALES", amount: 1 }] })))).toBe(400);
    expect(await code(as((ctx) => saveOpening(ctx, { startOn: addDay(today, 2), openingStock: null, lines: [] })))).toBe(400);

    // Balance sheet still balances with the stock brought in under capital.
    const bs = await as((ctx) => balanceSheet(ctx, today));
    expect(bs.difference).toBe(0);
    expect(bs.liabilities[0].lines.some((l) => l.key === "stock-in" && l.amount === 50_000_00)).toBe(true);

    // Clean up: no opening lines (the entry is reversed on its date).
    const v3 = await as((ctx) => saveOpening(ctx, { startOn: start, openingStock: null, lines: [] }));
    expect(v3.accounts.every((a) => !a.amount)).toBe(true);
  });
});

describe("year end, owner's figures, CA pack", () => {
  it("lists what is needed to close a year", async () => {
    const y = await as((ctx) => yearEnd(ctx, "2004-06-10"));
    expect(y.fy).toBe("2004-05");
    expect(y.to).toBe(fyEnd("2004-06-10"));
    expect(y.over).toBe(true);
    expect(y.steps.map((s) => s.key)).toEqual(["over", "check", "count", "bs"]);
    expect(y.nextYear).toBe("2005-06");
  });

  it("gives this month's figures and what is owed", async () => {
    const f = await as((ctx) => ownerFigures(ctx));
    expect(f.month.netProfit).toBe(f.month.grossProfit - f.month.running);
    expect(typeof f.gst).toBe("number");
    expect(f.payables.owed).toBeGreaterThanOrEqual(0);
  });

  it("zips the CA pack", async () => {
    const p = await as((ctx) => caPack(ctx, FROM, TO));
    expect(p.bytes.subarray(0, 2).toString()).toBe("PK");
    expect(p.names).toEqual(expect.arrayContaining(["01 Trial balance.pdf", "04 Balance sheet.pdf", `05 Books ${FROM} to ${TO}.xlsx`, "README.txt"]));
    expect(p.balanced).toBe(true);
  });

  it("writes zips other tools can read", () => {
    const z = zip([{ name: "a.txt", data: "hello hello hello" }]);
    const nameLen = z.readUInt16LE(26);
    const size = z.readUInt32LE(18);
    const data = inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + size));
    expect(data.toString()).toBe("hello hello hello");
    expect(z.readUInt32LE(14)).toBe(crc32(Buffer.from("hello hello hello")));
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("leaves the books check clean", async () => {
    const c = await as((ctx) => checkBooks(ctx));
    expect(c.results.filter((r) => !r.ok).map((r) => r.key)).toEqual([]);
  });
});
