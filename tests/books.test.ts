/**
 * The books backbone (A1) against the real database: starter heads and the
 * main bank, any number of bank accounts and the default bank, hidden heads
 * and closed banks, the books lock (owner opens it again), the ledger with a
 * running balance, the day book, the trial balance, the books check, and the
 * accountant's access.
 *
 * Runs in the demo tenant; the lock and the default bank are put back after.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { balanceOf, MoneyError, post, reverseEntry, withMoney, type Ctx } from "@/lib/ledger";
import {
  accountLedger,
  chartOfAccounts,
  checkBooks,
  createBank,
  createHead,
  dayBook,
  ensureBooks,
  fyStart,
  readPeriod,
  setBooksLock,
  setDefaultBank,
  STARTER_HEADS,
  todayIst,
  updateBank,
  updateHead,
} from "@/lib/books";
import { can, officeAllows } from "@/lib/permissions";
import { dayBookSheet, ledgerCsv, ledgerSheet, trialSheet } from "@/lib/books-export";
import { renderSheetPdf } from "@/lib/dues-export";

let T = "";
let adminId = "";
let originalDefault = "";
const run = Date.now().toString().slice(-6);
const today = todayIst();
const yesterday = new Date(Date.now() - 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
const books = <R>(fn: (ctx: Ctx) => Promise<R>) => withMoney(T, adminId, fn);
const code = async (p: Promise<unknown>) => p.then(() => 0, (e) => (e instanceof MoneyError ? e.status : -1));

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true } });
  T = demo.id;
  adminId = (await tenantDb(T).user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
});

afterAll(async () => {
  await prisma.tenant.update({ where: { id: T }, data: { booksLockedUntil: null } });
  if (originalDefault) await books((ctx) => setDefaultBank(ctx, originalDefault));
  // Leave the demo books tidy: test heads back to ₹0 and hidden, test banks closed.
  await books(async (ctx) => {
    for (const h of await ctx.tx.ledgerHead.findMany({ where: { name: { startsWith: "Test " }, key: null } })) {
      const left = await balanceOf(ctx, { type: "HEAD", headId: h.id });
      if (left) {
        if (!h.active) await updateHead(ctx, h.id, { active: true });
        await post(ctx, { kind: "OPENING", memo: "Test clean-up", lines: [{ account: { type: "HEAD", headId: h.id }, amount: -left }, { account: { type: "OFFICE_CASH" }, amount: left }] });
      }
      if (h.active || left) await updateHead(ctx, h.id, { active: false });
    }
    for (const b of await ctx.tx.bankAccount.findMany({ where: { name: { startsWith: "Test " }, isDefault: false, active: true } })) {
      if (!(await balanceOf(ctx, { type: "BANK", bankAccountId: b.id }))) await updateBank(ctx, b.id, { active: false });
    }
  });
});

describe("set-up", () => {
  it("creates the starter heads and the main bank once, on the old BANK account", async () => {
    await books((ctx) => ensureBooks(ctx));
    await books((ctx) => ensureBooks(ctx));
    const db = tenantDb(T);
    const keyed = await db.ledgerHead.findMany({ where: { key: { in: STARTER_HEADS.map((h) => h.key) } } });
    expect(keyed).toHaveLength(STARTER_HEADS.length);
    const banks = await db.bankAccount.findMany();
    expect(banks.filter((b) => b.isDefault)).toHaveLength(1);
    const main = banks.find((b) => b.ledgerCode === "BANK")!;
    expect(main).toBeTruthy();
    originalDefault = banks.find((b) => b.isDefault)!.id;
    const old = await db.ledgerAccount.findFirst({ where: { code: "BANK" } });
    if (old) expect(old.bankAccountId).toBe(main.id);
  });

  it("checks heads: names unique, groups allowed; renaming moves its account", async () => {
    const h = await books((ctx) => createHead(ctx, { name: `Test godown rent ${run}`, group: "INDIRECT_EXPENSES" }));
    expect(await code(books((ctx) => createHead(ctx, { name: `Test godown rent ${run}`, group: "INDIRECT_EXPENSES" })))).toBe(409);
    expect(await code(books((ctx) => createHead(ctx, { name: `Test bad ${run}`, group: "DEBTORS" })))).toBe(400);
    expect(await code(books((ctx) => createHead(ctx, { name: "x", group: "INDIRECT_EXPENSES" })))).toBe(400);
    await books((ctx) => post(ctx, { kind: "OPENING", memo: "test", lines: [{ account: { type: "HEAD", headId: h.id }, amount: 100 }, { account: { type: "OFFICE_CASH" }, amount: -100 }] }));
    await books((ctx) => updateHead(ctx, h.id, { name: `Test warehouse rent ${run}`, group: "DIRECT_EXPENSES" }));
    const acc = await tenantDb(T).ledgerAccount.findFirstOrThrow({ where: { headId: h.id } });
    expect(acc).toMatchObject({ name: `Test warehouse rent ${run}`, group: "DIRECT_EXPENSES", code: `HEAD:${h.id}` });
    await books((ctx) => post(ctx, { kind: "OPENING", memo: "test undo", lines: [{ account: { type: "HEAD", headId: h.id }, amount: -100 }, { account: { type: "OFFICE_CASH" }, amount: 100 }] }));
  });

  it("refuses posting to a hidden head, and takes it again when shown", async () => {
    const h = await books((ctx) => createHead(ctx, { name: `Test hidden ${run}`, group: "INDIRECT_EXPENSES" }));
    await books((ctx) => updateHead(ctx, h.id, { active: false }));
    const lines = [{ account: { type: "HEAD" as const, headId: h.id }, amount: 500 }, { account: { type: "OFFICE_CASH" as const }, amount: -500 }];
    expect(await code(books((ctx) => post(ctx, { kind: "OPENING", lines })))).toBe(400);
    await books((ctx) => updateHead(ctx, h.id, { active: true }));
    await books((ctx) => post(ctx, { kind: "OPENING", lines }));
    await books((ctx) => post(ctx, { kind: "OPENING", lines: lines.map((l) => ({ ...l, amount: -l.amount })) }));
  });
});

describe("bank accounts", () => {
  let capital = "";
  let second = "";
  beforeAll(async () => {
    capital = (await books((ctx) => createHead(ctx, { name: `Test capital ${run}`, group: "CAPITAL" }))).id;
  });

  it("adds any number of banks and checks their details", async () => {
    expect(await code(books((ctx) => createBank(ctx, { name: `Test HDFC ${run}`, ifsc: "HDFC123" })))).toBe(400);
    expect(await code(books((ctx) => createBank(ctx, { name: `Test HDFC ${run}`, last4: "12a4" })))).toBe(400);
    const b = await books((ctx) => createBank(ctx, { name: `Test HDFC ${run}`, kind: "CC", bankName: "HDFC Bank", last4: "4321", ifsc: "hdfc0001234", odLimit: 50_000_000 }));
    expect(b).toMatchObject({ ledgerCode: `BANK:${b.id}`, ifsc: "HDFC0001234", odLimit: 50_000_000, isDefault: false });
    expect(await code(books((ctx) => createBank(ctx, { name: `Test HDFC ${run}` })))).toBe(409);
    const s = await books((ctx) => createBank(ctx, { name: `Test SBI ${run}`, kind: "SAVINGS", odLimit: 100 }));
    expect(s.odLimit).toBeNull();
    second = b.id;
  });

  it("puts unchosen bank money in the default bank, and chosen money in its own", async () => {
    const before = await books((ctx) => accountLedger(ctx, `BANK:${second}`, today, today));
    await books((ctx) => post(ctx, { kind: "OPENING", memo: `Test capital in ${run}`, lines: [{ account: { type: "BANK", bankAccountId: second }, amount: 70_000 }, { account: { type: "HEAD", headId: capital }, amount: -70_000 }] }));
    const after = await books((ctx) => accountLedger(ctx, `BANK:${second}`, today, today));
    expect(after.closing - before.closing).toBe(70_000);

    await books((ctx) => setDefaultBank(ctx, second));
    const e = await books((ctx) => post(ctx, { kind: "OPENING", memo: `Test default ${run}`, lines: [{ account: { type: "BANK" }, amount: 1_000 }, { account: { type: "HEAD", headId: capital }, amount: -1_000 }] }));
    const line = await tenantDb(T).ledgerLine.findFirstOrThrow({ where: { entryId: e.id, amount: 1_000 }, include: { account: true } });
    expect(line.account.bankAccountId).toBe(second);
    const banks = await tenantDb(T).bankAccount.findMany({ where: { isDefault: true } });
    expect(banks.map((b) => b.id)).toEqual([second]);
  });

  it("won't close the default bank or one with money; closed banks take nothing", async () => {
    expect(await code(books((ctx) => updateBank(ctx, second, { active: false })))).toBe(409);
    await books((ctx) => setDefaultBank(ctx, originalDefault));
    expect(await code(books((ctx) => updateBank(ctx, second, { active: false })))).toBe(409);
    await books((ctx) => post(ctx, { kind: "OPENING", memo: `Test capital out ${run}`, lines: [{ account: { type: "BANK", bankAccountId: second }, amount: -71_000 }, { account: { type: "HEAD", headId: capital }, amount: 71_000 }] }));
    await books((ctx) => updateBank(ctx, second, { active: false }));
    expect(await code(books((ctx) => post(ctx, { kind: "OPENING", lines: [{ account: { type: "BANK", bankAccountId: second }, amount: 1 }, { account: { type: "HEAD", headId: capital }, amount: -1 }] })))).toBe(400);
    expect(await code(books((ctx) => setDefaultBank(ctx, second)))).toBe(409);
    const { after } = await books((ctx) => updateBank(ctx, second, { name: `Test HDFC CC ${run}`, active: true }));
    expect(after.active).toBe(true);
    expect((await tenantDb(T).ledgerAccount.findFirstOrThrow({ where: { bankAccountId: second } })).name).toBe(`Test HDFC CC ${run}`);
  });
});

describe("books lock", () => {
  let head = "";
  beforeAll(async () => {
    head = (await books((ctx) => createHead(ctx, { name: `Test lock ${run}`, group: "INDIRECT_EXPENSES" }))).id;
  });
  const entry = (when: Date) =>
    books((ctx) => post(ctx, { kind: "OPENING", occurredAt: when, lines: [{ account: { type: "HEAD", headId: head }, amount: 300 }, { account: { type: "OFFICE_CASH" }, amount: -300 }] }));

  it("refuses entries on or before the closed day, not after", async () => {
    const e = await entry(new Date());
    await books((ctx) => setBooksLock(ctx, yesterday, false));
    expect(await code(entry(new Date(`${yesterday}T12:00:00+05:30`)))).toBe(409);
    expect(await code(entry(new Date(`${yesterday}T23:59:00+05:30`)))).toBe(409);
    const ok = await entry(new Date(`${today}T00:01:00+05:30`));
    await books((ctx) => reverseEntry(ctx, ok.id, "test"));
    await books((ctx) => setBooksLock(ctx, today, false));
    expect(await code(books((ctx) => reverseEntry(ctx, e.id, "test")))).toBe(409);
    expect(await code(entry(new Date()))).toBe(409);
  });

  it("only the owner opens closed days again; never closes the future", async () => {
    expect(await code(books((ctx) => setBooksLock(ctx, yesterday, false)))).toBe(403);
    expect(await code(books((ctx) => setBooksLock(ctx, null, false)))).toBe(403);
    expect(await code(books((ctx) => setBooksLock(ctx, "2999-01-01", true)))).toBe(400);
    expect(await code(books((ctx) => setBooksLock(ctx, "2026-02-30", true)))).toBe(400);
    expect(await books((ctx) => setBooksLock(ctx, null, true))).toEqual({ before: today, after: null });
    const e = await tenantDb(T).journalEntry.findFirstOrThrow({ where: { lines: { some: { account: { headId: head } } } }, orderBy: { createdAt: "asc" } });
    await books((ctx) => reverseEntry(ctx, e.id, "test"));
  });
});

describe("ledger, day book, trial balance, check", () => {
  let head = "";
  beforeAll(async () => {
    head = (await books((ctx) => createHead(ctx, { name: `Test ledger ${run}`, group: "INDIRECT_EXPENSES" }))).id;
    for (const [day, amount] of [[yesterday, 1_000], [today, 2_500], [today, -500]] as const) {
      await books((ctx) => post(ctx, { kind: "OPENING", memo: `Test ledger ${amount}`, occurredAt: new Date(`${day}T10:00:00+05:30`), lines: [{ account: { type: "HEAD", headId: head }, amount }, { account: { type: "OFFICE_CASH" }, amount: -amount }] }));
    }
  });

  it("gives opening, running balance and closing", async () => {
    const l = await books((ctx) => accountLedger(ctx, `HEAD:${head}`, today, today));
    expect(l.opening).toBe(1_000);
    expect(l.rows.map((r) => r.balance)).toEqual([3_500, 3_000]);
    expect(l).toMatchObject({ debit: 2_500, credit: 500, closing: 3_000, groupLabel: "Office and running expenses" });
    expect(l.rows[0].against).toBe("Office cash");
    const csv = ledgerCsv(l);
    expect(csv.at(-1)).toEqual([today, "", "Closing balance", "", "", "", "30.00 Dr"]);
    const pdf = await renderSheetPdf(ledgerSheet(l), { name: "Test" });
    expect(pdf.byteLength).toBeGreaterThan(1000);
    const empty = await books((ctx) => accountLedger(ctx, "PURCHASES", today, today));
    expect(empty).toMatchObject({ name: "Purchases", opening: 0, rows: [] });
    expect(await code(books((ctx) => accountLedger(ctx, "HEAD:nope", today, today)))).toBe(404);
  });

  it("day book has every entry with debits = credits", async () => {
    const d = await books((ctx) => dayBook(ctx, today, today));
    expect(d.debit).toBe(d.credit);
    expect(d.entries.some((e) => e.memo === "Test ledger 2500")).toBe(true);
    const only = await books((ctx) => dayBook(ctx, yesterday, today, "OPENING"));
    expect(only.entries.every((e) => e.kind === "OPENING")).toBe(true);
    expect((await renderSheetPdf(dayBookSheet(only), { name: "Test" })).byteLength).toBeGreaterThan(1000);
  });

  it("trial balance agrees and shows the head", async () => {
    const c = await books((ctx) => chartOfAccounts(ctx));
    expect(c.difference).toBe(0);
    expect(c.debit).toBe(c.credit);
    const row = c.groups.flatMap((g) => g.rows).find((r) => r.headId === head)!;
    expect(row.balance).toBe(3_000);
    const asOnYesterday = await books((ctx) => chartOfAccounts(ctx, yesterday));
    expect(asOnYesterday.groups.flatMap((g) => g.rows).find((r) => r.headId === head)!.balance).toBe(1_000);
    expect(trialSheet(c, today).rows.at(-1)).toMatchObject({ kind: "total" });
  });

  it("the books check is clean", async () => {
    const c = await books((ctx) => checkBooks(ctx));
    expect(c.results.filter((r) => !r.ok)).toEqual([]);
    expect(c.ok).toBe(true);
  });

  it("reads periods: this financial year by default, at most 400 days", () => {
    expect(readPeriod(new URLSearchParams())).toEqual({ from: fyStart(today), to: today });
    expect(readPeriod(new URLSearchParams(), "today")).toEqual({ from: today, to: today });
    expect(readPeriod(new URLSearchParams({ from: "2026-05-02", to: "2026-05-01" }))).toHaveProperty("error");
    expect(readPeriod(new URLSearchParams({ from: "2024-01-01", to: "2026-01-01" }))).toHaveProperty("error");
    expect(fyStart("2027-03-31")).toBe("2026-04-01");
    expect(fyStart("2027-04-01")).toBe("2027-04-01");
  });
});

describe("accountant", () => {
  it("does the accounting, not the rest of the business", () => {
    for (const p of ["accounts.view", "accounts.post", "accounts.setup", "accounts.lock", "ledger.view", "payments.collect", "bank.reconcile", "reports.view"] as const) {
      expect(can("ACCOUNTANT", p)).toBe(true);
    }
    expect(can("ACCOUNTANT", "catalogue.manage")).toBe(false);
    expect(can("SALES_AGENT", "accounts.view")).toBe(false);
    expect(can("ADMIN", "accounts.lock")).toBe(true);
  });

  it("opens only the money pages of the office", () => {
    for (const p of ["/admin/books", "/admin/books/ledger", "/admin/khata/abc", "/admin/invoices", "/admin/bank", "/admin/reports/outstanding"]) expect(officeAllows("ACCOUNTANT", p)).toBe(true);
    for (const p of ["/admin", "/admin/orders", "/admin/team", "/admin/settings", "/admin/bookshelf", "/admin/products"]) expect(officeAllows("ACCOUNTANT", p)).toBe(false);
    expect(officeAllows("ADMIN", "/admin/settings")).toBe(true);
    expect(officeAllows("SALES_AGENT", "/admin/books")).toBe(false);
  });
});
