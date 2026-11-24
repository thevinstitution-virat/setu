import type { AccountGroup, AccountType } from "@/generated/prisma/client";
import { checkBooks, dayEnd, dayStart, ensureBooks, fyName, fyStart, GROUP_ORDER, GROUPS, isDay, ledgerHref, rollAccounts, showDay, todayIst, type CheckResult, type RolledRow } from "@/lib/books";
import { MoneyError, NAMES, post, reverseEntry, type AccountRef, type Ctx, type Line } from "@/lib/ledger";
import { closingStock } from "@/lib/stock-counts";
import { payablesBySupplier } from "@/lib/supplier-payments";
import { pendingClaims } from "@/lib/claims";

/**
 * Final accounts (A7): trial balance for a period, profit and loss with
 * opening and closing stock, balance sheet, opening the books, year end and
 * the owner's figures. Everything is read from the one ledger; stock is not a
 * ledger account (purchases are expensed), so it comes from the stock value or
 * the accepted counts (lib/stock-counts.ts).
 */

const DAY = 86_400_000;
export const PL_GROUPS: AccountGroup[] = ["SALES", "OTHER_INCOME", "PURCHASES", "DIRECT_EXPENSES", "INDIRECT_EXPENSES"];
const isPl = (g: AccountGroup) => PL_GROUPS.includes(g);
/** The largest amount one ledger line holds (LedgerLine.amount is a 32-bit Int). */
const LINE_MAX = 2_000_000_000;
const MAX_DAYS = 400;

export const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** The same day n years on (29 Feb becomes 28 Feb). */
export function shiftYear(d: string, n: number) {
  const s = `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;
  return isDay(s) ? s : `${Number(d.slice(0, 4)) + n}-02-28`;
}
/** 31 March of the financial year a day is in. */
export const fyEnd = (day: string) => `${Number(fyStart(day).slice(0, 4)) + 1}-03-31`;
const istDayOf = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function period(from: string, to: string) {
  if (!isDay(from) || !isDay(to)) throw new MoneyError("Dates must be YYYY-MM-DD");
  if (to < from) throw new MoneyError("The end date is before the start date");
  if ((Date.parse(to) - Date.parse(from)) / DAY > MAX_DAYS) throw new MoneyError(`Pick at most ${MAX_DAYS} days`);
}

/** Per ledger account: [before `from`, debits in the period, credits in the period] up to the end of `to`. */
async function sums(ctx: Ctx, from: string | null, to: string) {
  const start = from ? dayStart(from) : new Date(0);
  const end = dayEnd(to);
  const rows = await ctx.tx.$queryRaw<{ id: string; opening: bigint; debit: bigint; credit: bigint }[]>`
    SELECT l."accountId" AS id,
      COALESCE(SUM(l.amount) FILTER (WHERE e."occurredAt" < ${start}), 0)::bigint AS opening,
      COALESCE(SUM(l.amount) FILTER (WHERE e."occurredAt" >= ${start} AND l.amount > 0), 0)::bigint AS debit,
      COALESCE(SUM(-l.amount) FILTER (WHERE e."occurredAt" >= ${start} AND l.amount < 0), 0)::bigint AS credit
    FROM "LedgerLine" l JOIN "JournalEntry" e ON e.id = l."entryId"
    WHERE l."tenantId" = ${ctx.tenantId} AND e."occurredAt" <= ${end}
    GROUP BY l."accountId"`;
  return new Map(rows.map((r) => [r.id, [Number(r.opening), Number(r.debit), Number(r.credit)]]));
}

const withPeriod = (r: RolledRow, from: string, to: string) => (r.code ? `${ledgerHref(r.code)}&${new URLSearchParams({ from, to })}` : r.href);

// ───────────────────────────── A7.1 trial balance ─────────────────────────────

export type TrialRow = { key: string; name: string; count?: number; href: string | null; opening: number; debit: number; credit: number; closing: number };
export type TrialGroup = { group: AccountGroup; label: string; rows: TrialRow[]; opening: number; debit: number; credit: number; closing: number };

/** Every account's opening, debits, credits and closing for a period, by group (debit positive). */
export async function trialBalance(ctx: Ctx, from: string, to: string) {
  period(from, to);
  const rolled = await rollAccounts(ctx, await sums(ctx, from, to), 3);
  const rows = rolled
    .map((r) => ({ key: r.key, name: r.name, count: r.count, group: r.group, href: withPeriod(r, from, to), opening: r.v[0], debit: r.v[1], credit: r.v[2], closing: r.v[0] + r.v[1] - r.v[2] }))
    .filter((r) => r.opening || r.debit || r.credit);
  const groups: TrialGroup[] = GROUP_ORDER.map((g) => {
    const rs: TrialRow[] = rows
      .filter((r) => r.group === g)
      .map((r) => ({ key: r.key, name: r.name, count: r.count, href: r.href, opening: r.opening, debit: r.debit, credit: r.credit, closing: r.closing }));
    const s = (k: "opening" | "debit" | "credit" | "closing") => rs.reduce((a, r) => a + r[k], 0);
    return { group: g, label: GROUPS[g].label, rows: rs, opening: s("opening"), debit: s("debit"), credit: s("credit"), closing: s("closing") };
  }).filter((g) => g.rows.length);
  const side = (k: "opening" | "closing", dr: boolean) => rows.reduce((a, r) => a + (dr ? Math.max(0, r[k]) : Math.max(0, -r[k])), 0);
  const totals = {
    openingDr: side("opening", true),
    openingCr: side("opening", false),
    debit: rows.reduce((a, r) => a + r.debit, 0),
    credit: rows.reduce((a, r) => a + r.credit, 0),
    closingDr: side("closing", true),
    closingCr: side("closing", false),
  };
  return { from, to, groups, totals, difference: totals.closingDr - totals.closingCr };
}

// ───────────────────────────── stock for the accounts ─────────────────────────────

/** The switch date (or the first entry's day) and the stock brought in then. */
async function booksStart(ctx: Ctx) {
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { booksStartOn: true, openingStock: true, openingEntryId: true } });
  let start = t.booksStartOn ? t.booksStartOn.toISOString().slice(0, 10) : null;
  if (!start) {
    const first = await ctx.tx.journalEntry.findFirst({ orderBy: { occurredAt: "asc" }, select: { occurredAt: true } });
    start = first ? istDayOf(first.occurredAt) : null;
  }
  return { start, set: !!t.booksStartOn, openingStock: t.openingStock === null ? null : Number(t.openingStock), openingEntryId: t.openingEntryId };
}
type Start = Awaited<ReturnType<typeof booksStart>>;

/** Stock at the start of `from`: the opening balances' stock for the first period, else the closing stock of the day before. */
async function openingStockFor(ctx: Ctx, from: string, s: Start) {
  if (s.start && from <= s.start && s.openingStock !== null) return { value: s.openingStock, source: "opening" as const, warning: null };
  const c = await closingStock(ctx, addDay(from, -1));
  return { value: c.value, source: c.source, warning: c.warning };
}

/** The stock the books started with (it sits under capital on the balance sheet). */
async function stockBroughtIn(ctx: Ctx, s: Start) {
  if (s.openingStock !== null) return s.openingStock;
  if (!s.start) return 0;
  return (await closingStock(ctx, addDay(s.start, -1))).value;
}

// ───────────────────────────── A7.2 profit and loss ─────────────────────────────

export type PlLine = { key: string; name: string; amount: number; href: string | null };
type Section = { lines: PlLine[]; total: number };

async function plCore(ctx: Ctx, from: string, to: string, s: Start) {
  const rolled = (await rollAccounts(ctx, await sums(ctx, from, to), 3)).filter((r) => isPl(r.group) && (r.v[1] || r.v[2]));
  const sec = (g: AccountGroup, credit: boolean): Section => {
    const lines = rolled
      .filter((r) => r.group === g)
      .map((r) => ({ key: r.key, name: r.name, amount: credit ? r.v[2] - r.v[1] : r.v[1] - r.v[2], href: withPeriod(r, from, to) }))
      .filter((l) => l.amount !== 0);
    return { lines, total: lines.reduce((a, l) => a + l.amount, 0) };
  };
  const salesRows = rolled.filter((r) => r.group === "SALES");
  const salesGross = salesRows.reduce((a, r) => a + r.v[2], 0);
  const returns = salesRows.reduce((a, r) => a + r.v[1], 0);
  const purchases = sec("PURCHASES", false);
  const direct = sec("DIRECT_EXPENSES", false);
  const indirect = sec("INDIRECT_EXPENSES", false);
  const otherIncome = sec("OTHER_INCOME", true);
  const [open, close] = await Promise.all([openingStockFor(ctx, from, s), closingStock(ctx, to)]);
  const salesNet = salesGross - returns;
  const costOfGoods = open.value + purchases.total - close.value;
  const grossProfit = salesNet - costOfGoods - direct.total;
  const netProfit = grossProfit - indirect.total + otherIncome.total;
  const warnings = [
    open.warning ? `Opening stock: ${open.warning}` : null,
    close.warning ? `Closing stock: ${close.warning}` : null,
    costOfGoods < 0
      ? `Cost of goods is below zero: the stock at the end is more than the stock at the start plus purchases. Some stock came in without a purchase bill, or the opening stock is missing (Opening balances).`
      : null,
  ].filter((w): w is string => !!w);
  return {
    from,
    to,
    sales: { gross: salesGross, returns, net: salesNet, lines: sec("SALES", true).lines },
    openingStock: open.value,
    openingStockFrom: open.source,
    purchases,
    closingStock: close.value,
    closingStockFrom: close.source,
    costOfGoods,
    direct,
    grossProfit,
    indirect,
    otherIncome,
    netProfit,
    warnings,
  };
}

/** Month by month: sales, purchases, gross profit, running costs, net profit (each month's stock at its end). */
async function plMonths(ctx: Ctx, from: string, to: string, openingStock: number) {
  const rows = await ctx.tx.$queryRaw<{ m: string; g: string; dr: bigint; cr: bigint }[]>`
    SELECT to_char((e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS m, a."group"::text AS g,
      COALESCE(SUM(l.amount) FILTER (WHERE l.amount > 0), 0)::bigint AS dr,
      COALESCE(SUM(-l.amount) FILTER (WHERE l.amount < 0), 0)::bigint AS cr
    FROM "LedgerLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "LedgerAccount" a ON a.id = l."accountId"
    WHERE l."tenantId" = ${ctx.tenantId} AND e."occurredAt" >= ${dayStart(from)} AND e."occurredAt" <= ${dayEnd(to)}
    GROUP BY 1, 2`;
  const get = (m: string, g: AccountGroup) => rows.find((r) => r.m === m && r.g === g);
  const net = (m: string, g: AccountGroup, credit: boolean) => {
    const r = get(m, g);
    return r ? (credit ? Number(r.cr) - Number(r.dr) : Number(r.dr) - Number(r.cr)) : 0;
  };
  const out = [];
  let open = openingStock;
  for (let mFrom = from; mFrom <= to;) {
    const ym = mFrom.slice(0, 7);
    const monthEnd = addDay(`${Number(ym.slice(0, 4)) + (ym.slice(5) === "12" ? 1 : 0)}-${ym.slice(5) === "12" ? "01" : String(Number(ym.slice(5)) + 1).padStart(2, "0")}-01`, -1);
    const mTo = monthEnd < to ? monthEnd : to;
    const close = (await closingStock(ctx, mTo)).value;
    const sales = net(ym, "SALES", true);
    const purchases = net(ym, "PURCHASES", false);
    const direct = net(ym, "DIRECT_EXPENSES", false);
    const gross = sales - (open + purchases - close) - direct;
    const running = net(ym, "INDIRECT_EXPENSES", false) - net(ym, "OTHER_INCOME", true);
    out.push({ month: ym, from: mFrom, to: mTo, sales, purchases, openingStock: open, closingStock: close, grossProfit: gross, running, netProfit: gross - running });
    open = close;
    mFrom = addDay(mTo, 1);
  }
  return out;
}

/** Profit and loss for a period: trading (sales, stock, purchases, direct costs), then running costs and other income. */
export async function profitAndLoss(ctx: Ctx, from: string, to: string, o: { months?: boolean; compare?: boolean } = {}) {
  period(from, to);
  const s = await booksStart(ctx);
  const pl = await plCore(ctx, from, to, s);
  const months = o.months ? await plMonths(ctx, from, to, pl.openingStock) : null;
  let lastYear: null | { from: string; to: string; salesNet: number; grossProfit: number; netProfit: number; purchases: number; running: number } = null;
  if (o.compare) {
    const lf = shiftYear(from, -1);
    const lt = shiftYear(to, -1);
    const any = await ctx.tx.journalEntry.count({ where: { occurredAt: { gte: dayStart(lf), lte: dayEnd(lt) } } });
    if (any) {
      const p = await plCore(ctx, lf, lt, s);
      lastYear = { from: lf, to: lt, salesNet: p.sales.net, grossProfit: p.grossProfit, netProfit: p.netProfit, purchases: p.purchases.total, running: p.indirect.total - p.otherIncome.total };
    }
  }
  return { ...pl, months, lastYear };
}

// ───────────────────────────── A7.3 balance sheet ─────────────────────────────

export type BsLine = { key: string; name: string; amount: number; href: string | null; count?: number };
export type BsSection = { key: string; label: string; lines: BsLine[]; total: number };

/**
 * Balance sheet as at the end of a day. Liabilities and capital are shown
 * credit positive, assets debit positive. Profit for the year sits under
 * capital (there are no closing entries: income and expenses add up from the
 * start, and the stock is added on).
 */
export async function balanceSheet(ctx: Ctx, asOn: string) {
  if (!isDay(asOn)) throw new MoneyError("Pick a date");
  const s = await booksStart(ctx);
  const rolled = (await rollAccounts(ctx, await sums(ctx, null, asOn), 3)).map((r) => ({ ...r, bal: r.v[1] - r.v[2] }));
  const [stock, broughtIn] = await Promise.all([closingStock(ctx, asOn), stockBroughtIn(ctx, s)]);
  const incExp = rolled.filter((r) => isPl(r.group)).reduce((a, r) => a + r.bal, 0);
  const accumulated = -incExp + stock.value - broughtIn;
  const yearFrom = s.start && s.start > fyStart(asOn) ? s.start : fyStart(asOn);
  const thisYear = yearFrom <= asOn ? (await plCore(ctx, yearFrom, asOn, s)).netProfit : 0;
  const earlier = accumulated - thisYear;

  const lines = (g: AccountGroup, credit: boolean): BsLine[] =>
    rolled
      .filter((r) => r.group === g && r.bal)
      .map((r) => ({
        key: r.key,
        name: r.name,
        amount: credit ? -r.bal : r.bal,
        href: r.code ? `${ledgerHref(r.code)}&${new URLSearchParams({ from: fyStart(asOn), to: asOn })}` : r.href,
        count: r.count,
      }));
  const section = (key: string, label: string, ls: BsLine[]): BsSection => ({ key, label, lines: ls, total: ls.reduce((a, l) => a + l.amount, 0) });

  const capitalLines = [...lines("CAPITAL", true), ...lines("DRAWINGS", true)];
  if (broughtIn) capitalLines.push({ key: "stock-in", name: "Opening stock brought in", amount: broughtIn, href: "/admin/books/opening" });
  if (earlier) capitalLines.push({ key: "pl-earlier", name: "Profit of earlier years", amount: earlier, href: null });
  capitalLines.push({
    key: "pl-year",
    name: `Profit for ${showDay(yearFrom)} to ${showDay(asOn)}`,
    amount: thisYear,
    href: `/admin/books/final?${new URLSearchParams({ report: "pl", from: yearFrom, to: asOn })}`,
  });

  const liabilities = [
    section("capital", "Capital", capitalLines),
    section("loans", GROUPS.LOANS.label, lines("LOANS", true)),
    section("creditors", GROUPS.CREDITORS.label, lines("CREDITORS", true)),
    section("other", GROUPS.CURRENT_LIABILITIES.label, lines("CURRENT_LIABILITIES", true)),
    section("taxes", GROUPS.DUTIES_TAXES.label, lines("DUTIES_TAXES", true)),
  ].filter((x) => x.lines.length);
  const assets = [
    section("fixed", GROUPS.FIXED_ASSETS.label, lines("FIXED_ASSETS", false)),
    section("stock", "Stock", [{ key: "stock", name: `Closing stock at cost${stock.source === "count" ? " (counted)" : ""}`, amount: stock.value, href: `/admin/books/stock?day=${asOn}` }]),
    section("debtors", GROUPS.DEBTORS.label, lines("DEBTORS", false)),
    section("claims", GROUPS.CLAIMS.label, lines("CLAIMS", false)),
    section("cash", GROUPS.CASH.label, lines("CASH", false)),
    section("bank", GROUPS.BANK.label, lines("BANK", false)),
    section("transit", GROUPS.IN_TRANSIT.label, lines("IN_TRANSIT", false)),
    section("current", GROUPS.CURRENT_ASSETS.label, lines("CURRENT_ASSETS", false)),
  ].filter((x) => x.lines.length && (x.key !== "stock" || x.total));
  const totalLiabilities = liabilities.reduce((a, x) => a + x.total, 0);
  const totalAssets = assets.reduce((a, x) => a + x.total, 0);
  const difference = totalAssets - totalLiabilities;
  let failing: CheckResult[] = [];
  if (difference) failing = (await checkBooks(ctx)).results.filter((r) => !r.ok);
  return {
    asOn,
    liabilities,
    assets,
    totalLiabilities,
    totalAssets,
    difference,
    failing,
    profit: { thisYear, earlier, from: yearFrom },
    stock: { value: stock.value, source: stock.source, warning: stock.warning, note: stock.note },
  };
}

// ───────────────────────────── A7.4 opening the books ─────────────────────────────

/** Built-in accounts an opening balance may be entered for (shops and suppliers come bill by bill). */
const OPENING_BUILT_INS: AccountType[] = ["OFFICE_CASH", "GST_INPUT", "GST_OUTPUT", "TDS_RECEIVABLE", "TDS_PAYABLE"];
const BUILT_IN_GROUP: Partial<Record<AccountType, AccountGroup>> = {
  OFFICE_CASH: "CASH",
  GST_INPUT: "DUTIES_TAXES",
  GST_OUTPUT: "DUTIES_TAXES",
  TDS_RECEIVABLE: "DUTIES_TAXES",
  TDS_PAYABLE: "DUTIES_TAXES",
};

export type OpeningAccount = { code: string; name: string; group: AccountGroup; groupLabel: string; amount: number; active: boolean };

/** The opening trial balance: what was entered, shops' and suppliers' opening bills, and whether it agrees. */
export async function openingView(ctx: Ctx) {
  await ensureBooks(ctx);
  const s = await booksStart(ctx);
  const entered = new Map<string, number>();
  let enteredAt: string | null = null;
  if (s.openingEntryId) {
    const e = await ctx.tx.journalEntry.findUnique({ where: { id: s.openingEntryId }, include: { lines: { include: { account: { select: { code: true } } } }, reversedBy: { select: { id: true } } } });
    if (e && !e.reversedBy) {
      enteredAt = istDayOf(e.occurredAt);
      for (const l of e.lines) if (l.account.code !== "OPENING_EQUITY") entered.set(l.account.code, (entered.get(l.account.code) ?? 0) + l.amount);
    }
  }
  const [heads, banks] = await Promise.all([ctx.tx.ledgerHead.findMany({ orderBy: { name: "asc" } }), ctx.tx.bankAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] })]);
  const accounts: OpeningAccount[] = [
    ...OPENING_BUILT_INS.map((t) => ({ code: t, name: NAMES[t], group: BUILT_IN_GROUP[t]!, active: true })),
    ...banks.map((b) => ({ code: b.ledgerCode, name: b.name, group: "BANK" as AccountGroup, active: b.active })),
    ...heads.map((h) => ({ code: `HEAD:${h.id}`, name: h.name, group: h.group, active: h.active })),
  ]
    .map((a) => ({ ...a, groupLabel: GROUPS[a.group].label, amount: entered.get(a.code) ?? 0 }))
    .filter((a) => a.active || a.amount)
    .sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group) || x.name.localeCompare(y.name));

  // Shops' and suppliers' opening bills (entered on their own pages).
  const party = await ctx.tx.$queryRaw<{ t: string; amount: bigint; n: bigint }[]>`
    SELECT a."type"::text AS t, COALESCE(SUM(l.amount), 0)::bigint AS amount, COUNT(DISTINCT a.id)::bigint AS n
    FROM "LedgerLine" l JOIN "JournalEntry" e ON e.id = l."entryId" JOIN "LedgerAccount" a ON a.id = l."accountId"
    WHERE l."tenantId" = ${ctx.tenantId} AND e.kind = 'OPENING' AND a."type" IN ('RECEIVABLE', 'WALLET', 'PAYABLE')
      AND NOT EXISTS (SELECT 1 FROM "JournalEntry" r WHERE r."reversesId" = e.id)
    GROUP BY 1`;
  const p = (t: string) => party.find((x) => x.t === t);
  const shops = { dues: Number(p("RECEIVABLE")?.amount ?? 0), advances: -Number(p("WALLET")?.amount ?? 0), count: Number(p("RECEIVABLE")?.n ?? 0) };
  const suppliers = { owed: -Number(p("PAYABLE")?.amount ?? 0), count: Number(p("PAYABLE")?.n ?? 0) };

  const eq = await ctx.tx.ledgerLine.aggregate({ where: { account: { code: "OPENING_EQUITY" } }, _sum: { amount: true } });
  const equity = Number(eq._sum.amount ?? 0);
  const stock = s.openingStock ?? 0;
  const startOn = s.set ? s.start : null;
  const suggestion = startOn ? await closingStock(ctx, addDay(startOn, -1)) : null;
  const debit = [...entered.values()].reduce((a, v) => a + Math.max(0, v), 0) + shops.dues + stock;
  const credit = [...entered.values()].reduce((a, v) => a + Math.max(0, -v), 0) + shops.advances + suppliers.owed;
  return {
    startOn,
    firstEntryDay: s.set ? null : s.start,
    enteredAt,
    openingStock: s.openingStock,
    stockSuggestion: suggestion ? { value: suggestion.value, source: suggestion.source, day: addDay(startOn!, -1) } : null,
    accounts,
    shops,
    suppliers,
    debit,
    credit,
    /** Debit positive: what the opening balances are out by (0 = they agree). */
    difference: equity - stock,
  };
}

export type OpeningInput = { startOn: string; openingStock: number | null; lines: { code: string; amount: number }[] };

async function openingRef(ctx: Ctx, code: string): Promise<AccountRef> {
  if (code.startsWith("HEAD:")) {
    const h = await ctx.tx.ledgerHead.findUnique({ where: { id: code.slice(5) } });
    if (!h) throw new MoneyError("Account head not found", 404);
    return { type: "HEAD", headId: h.id };
  }
  if ((OPENING_BUILT_INS as string[]).includes(code)) return { type: code as AccountType };
  const bank = await ctx.tx.bankAccount.findFirst({ where: { ledgerCode: code } });
  if (bank) return { type: "BANK", bankAccountId: bank.id };
  throw new MoneyError("Shops' and suppliers' openings are entered bill by bill on their own pages", 400);
}

/** Lines of at most LINE_MAX paise each (a ledger line is a 32-bit number). */
function split(account: AccountRef, amount: number): Line[] {
  const out: Line[] = [];
  let left = amount;
  while (left) {
    const part = Math.sign(left) * Math.min(Math.abs(left), LINE_MAX);
    out.push({ account, amount: part });
    left -= part;
  }
  return out;
}

/**
 * Save the opening trial balance as on the switch date: one entry dated the
 * day before (heads, banks, cash, taxes; the rest to opening balances), and
 * the opening stock. Saving again replaces it (the old entry is reversed on
 * its own date).
 */
export async function saveOpening(ctx: Ctx, input: OpeningInput) {
  const startOn = input.startOn;
  if (!isDay(startOn)) throw new MoneyError("Pick the day the books start here");
  if (startOn > todayIst()) throw new MoneyError("The start day is in the future");
  const stock = input.openingStock;
  if (stock !== null && (!Number.isInteger(stock) || stock < 0 || stock > 1e15)) throw new MoneyError("Opening stock must be a value in rupees");
  if (!Array.isArray(input.lines) || input.lines.length > 2000) throw new MoneyError("Too many lines");
  await ctx.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.tenantId}:opening`}))`;
  const seen = new Set<string>();
  const lines: Line[] = [];
  for (const l of input.lines) {
    const code = String(l.code ?? "");
    if (seen.has(code)) throw new MoneyError("An account is listed twice");
    seen.add(code);
    if (!Number.isInteger(l.amount) || Math.abs(l.amount) > 1e15) throw new MoneyError("Amounts must be in rupees and paise");
    if (!l.amount) continue;
    lines.push(...split(await openingRef(ctx, code), l.amount));
  }
  const at = dayEnd(addDay(startOn, -1));
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { openingEntryId: true } });
  if (t.openingEntryId) {
    const old = await ctx.tx.journalEntry.findUnique({ where: { id: t.openingEntryId }, select: { id: true, occurredAt: true, reversedBy: { select: { id: true } } } });
    if (old && !old.reversedBy) await reverseEntry(ctx, old.id, "Opening balances changed", old.occurredAt);
  }
  let entryId: string | null = null;
  if (lines.length) {
    const net = lines.reduce((a, l) => a + l.amount, 0);
    const e = await post(ctx, { kind: "OPENING", memo: "Opening balances (heads, banks, cash and taxes)", occurredAt: at, lines: [...lines, ...split({ type: "OPENING_EQUITY" }, -net)] });
    entryId = e.id;
  }
  await ctx.tx.tenant.update({ where: { id: ctx.tenantId }, data: { booksStartOn: new Date(`${startOn}T00:00:00Z`), openingStock: stock === null ? null : BigInt(stock), openingEntryId: entryId } });
  return openingView(ctx);
}

// ───────────────────────────── A7.6 year end ─────────────────────────────

/** Is a financial year ready to close: books check, the count at 31 March, the balance sheet. */
export async function yearEnd(ctx: Ctx, day = todayIst()) {
  const from = fyStart(day);
  const to = fyEnd(day);
  const asOn = to < todayIst() ? to : todayIst();
  const [check, bs, lock, stock] = await Promise.all([
    checkBooks(ctx),
    balanceSheet(ctx, asOn),
    ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { booksLockedUntil: true } }),
    closingStock(ctx, to < todayIst() ? to : todayIst()),
  ]);
  const lockedUntil = lock.booksLockedUntil ? lock.booksLockedUntil.toISOString().slice(0, 10) : null;
  const over = to < todayIst();
  const counted = stock.source === "count" || (stock.source === "book" && stock.lastCount?.date === to);
  return {
    fy: fyName(day),
    from,
    to,
    over,
    closed: !!lockedUntil && lockedUntil >= to,
    lockedUntil,
    steps: [
      { key: "over", ok: over, text: over ? `The year ended on ${showDay(to)}.` : `The year ends on ${showDay(to)}; close it after that.` },
      { key: "check", ok: check.ok, text: check.ok ? "The books check is clean." : `${check.results.filter((r) => !r.ok).length} books checks need fixing first.` },
      {
        key: "count",
        ok: over && counted,
        text: counted ? `Stock was counted on ${showDay(to)}.` : `Count the stock as at ${showDay(to)} (Books → Stock → Start a count): the count is the closing stock and next year's opening stock.`,
      },
      { key: "bs", ok: bs.difference === 0, text: bs.difference === 0 ? "The balance sheet balances." : "The balance sheet does not balance." },
    ],
    profit: bs.profit.thisYear,
    nextYear: fyName(addDay(to, 1)),
  };
}

// ───────────────────────────── A7.7 owner's figures ─────────────────────────────

/** This month so far, what is owed both ways, claims, and tax to pay. */
export async function ownerFigures(ctx: Ctx, today = todayIst()) {
  const monthFrom = `${today.slice(0, 7)}-01`;
  const s = await booksStart(ctx);
  const [month, payables, claims, taxes] = await Promise.all([
    plCore(ctx, monthFrom, today, s),
    payablesBySupplier(ctx, today),
    pendingClaims(ctx, today),
    ctx.tx.ledgerLine.groupBy({ by: ["accountId"], where: { account: { type: { in: ["GST_OUTPUT", "GST_INPUT", "TDS_PAYABLE"] } } }, _sum: { amount: true } }),
  ]);
  const accs = await ctx.tx.ledgerAccount.findMany({ where: { id: { in: taxes.map((t) => t.accountId) } }, select: { id: true, type: true } });
  const tax = (t: AccountType) => taxes.filter((x) => accs.find((a) => a.id === x.accountId)?.type === t).reduce((a, x) => a + Number(x._sum.amount ?? 0), 0);
  return {
    month: {
      from: monthFrom,
      to: today,
      sales: month.sales.net,
      grossProfit: month.grossProfit,
      running: month.indirect.total - month.otherIncome.total,
      netProfit: month.netProfit,
      warnings: month.warnings,
    },
    payables: { owed: payables.totals.owed, late: payables.totals.d30 + payables.totals.d60 + payables.totals.d90 + payables.totals.older, notDue: payables.totals.notDue },
    claims: { open: claims.totals.open, count: claims.totals.claims, older: claims.totals.d60 + claims.totals.d90 + claims.totals.older },
    /** Positive = to pay. */
    gst: -(tax("GST_OUTPUT") + tax("GST_INPUT")),
    tds: -tax("TDS_PAYABLE"),
  };
}
