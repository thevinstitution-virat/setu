import type { AccountGroup } from "@/generated/prisma/client";
import { MoneyError, type Ctx } from "@/lib/ledger";
import { createHead, dayEnd, fyStart, GROUPS, HEAD_GROUPS, isDay, showDay, todayIst } from "@/lib/books";
import { addDay, openingView, saveOpening, trialBalance } from "@/lib/final-accounts";
import { pendingClaims } from "@/lib/claims";
import { payablesBySupplier } from "@/lib/supplier-payments";
import { stockValuation } from "@/lib/stock-counts";
import { stockOn } from "@/lib/stock";
import { toPaise } from "@/lib/money";
import type { Row, RowError } from "@/lib/importers";

/**
 * A10: moving a business's books here from other software.
 *  - the "Move your books here" checklist;
 *  - the old trial balance as a sheet: matched to our accounts, checked
 *    (balanced; debtors, creditors and stock agree with the opening bills
 *    and stock), and used as the opening balances;
 *  - the parallel run: our trial balance, debtors, creditors and stock on a
 *    day against the old software's figures for the same day, line by line.
 */

const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/a\/c|account/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Each money cell: "1,23,456.50", "(500)" or "-500" → paise. */
function money(raw: string | undefined): number {
  let t = (raw ?? "").trim().replace(/[₹,\s]/g, "");
  if (!t) return 0;
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (/(dr|cr)$/i.test(t)) {
    neg = /cr$/i.test(t) !== neg;
    t = t.slice(0, -2);
  }
  const p = toPaise(t);
  return neg ? -p : p;
}

// ───────────────────────────── A10.1 checklist ─────────────────────────────

export type StepState = "done" | "todo" | "check";
export type Step = { key: string; title: string; state: StepState; text: string; href: string; cta: string };

/** Where the switch stands: one step per thing to move, in order. */
export async function switchOver(ctx: Ctx) {
  const v = await openingView(ctx);
  const today = todayIst();
  const [banks, t, suppliersWithOpening, claims, tracking] = await Promise.all([
    ctx.tx.bankAccount.findMany({ where: { active: true }, select: { ledgerCode: true } }),
    ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { booksLockedUntil: true } }),
    ctx.tx.supplierBill.count({ where: { kind: "OPENING" } }),
    v.startOn ? pendingClaims(ctx, addDay(v.startOn, -1)) : null,
    stockOn(ctx),
  ]);
  const lockedUntil = t.booksLockedUntil ? t.booksLockedUntil.toISOString().slice(0, 10) : null;
  const banksOpen = v.accounts.filter((a) => a.group === "BANK" && a.amount !== 0).length;
  const dayBefore = v.startOn ? addDay(v.startOn, -1) : null;
  const steps: Step[] = [
    {
      key: "date",
      title: "The day the books start here",
      state: v.startOn ? "done" : "todo",
      text: v.startOn
        ? `Books start here on ${showDay(v.startOn)}; the opening balances are as at the end of ${showDay(dayBefore!)}.`
        : "Pick the switch day: best the first day of a financial year (1 April), else the 1st of a month. Everything before it stays in the old software.",
      href: "/admin/books/opening",
      cta: v.startOn ? "Change" : "Pick the day",
    },
    {
      key: "tb",
      title: "Opening trial balance",
      state: !v.enteredAt ? "todo" : v.difference === 0 ? "done" : "check",
      text: !v.enteredAt
        ? "Bring in the old software's trial balance on the day before the switch (the sheet below), or type it on the opening balances page."
        : v.difference === 0
          ? "Entered, and it agrees with the shops' and suppliers' open bills and the opening stock."
          : `Entered, but it is out by ${inr(Math.abs(v.difference))}: the debtors, creditors or stock in it don't match the open bills or the stock (see the check below).`,
      href: "/admin/books/opening",
      cta: v.enteredAt ? "See it" : "Enter it",
    },
    {
      key: "banks",
      title: "Bank accounts",
      state: banks.length ? (banksOpen ? "done" : "check") : "todo",
      text: banks.length
        ? `${banks.length} bank account${banks.length === 1 ? "" : "s"} here; ${banksOpen} with an opening balance. Each bank's balance comes from the trial balance; match it to the bank statement on the day before the switch.`
        : "Add each bank account the business uses (name, number, IFSC) before the trial balance, so its balance has a place to go.",
      href: "/admin/books/banks",
      cta: banks.length ? "See banks" : "Add banks",
    },
    {
      key: "shops",
      title: "Shops' open bills",
      state: v.shops.count ? "done" : "todo",
      text: v.shops.count
        ? `${v.shops.count} shop${v.shops.count === 1 ? "" : "s"} with opening bills: ${inr(v.shops.dues)} due${v.shops.advances ? `, ${inr(v.shops.advances)} held as advances` : ""}.`
        : "Import the old software's debtors outstanding, bill by bill, so ageing, reminders and collections carry on (Import → Open bills).",
      href: "/admin/import",
      cta: "Import",
    },
    {
      key: "suppliers",
      title: "Suppliers' open bills",
      state: suppliersWithOpening || v.suppliers.count ? "done" : "todo",
      text:
        suppliersWithOpening || v.suppliers.count
          ? `${v.suppliers.count} supplier${v.suppliers.count === 1 ? "" : "s"} with opening bills: ${inr(v.suppliers.owed)} owed.`
          : "Import the suppliers, then what you owed each one bill by bill (Suppliers, then Suppliers' open bills).",
      href: "/admin/books/import?type=supplier_bills",
      cta: "Import",
    },
    {
      key: "claims",
      title: "Claims pending with companies",
      state: claims && claims.totals.claims ? "done" : "check",
      text:
        claims && claims.totals.claims
          ? `${claims.totals.claims} claim${claims.totals.claims === 1 ? "" : "s"} open on the switch day: ${inr(claims.totals.open)}.`
          : "Enter each scheme or rate-difference claim the companies still owe, dated on or before the switch day. Skip this if there are none.",
      href: "/admin/books/claims",
      cta: "Claims",
    },
    {
      key: "stock",
      title: "Opening stock",
      state: v.openingStock !== null ? "done" : "todo",
      text:
        v.openingStock !== null
          ? `Opening stock ${inr(v.openingStock)}.${tracking ? " Count it on the switch day so the app's stock starts right." : ""}`
          : tracking
            ? "Count the stock on the switch day (Books → Stock → Start a count) and enter its value as the opening stock."
            : "Enter the value of the stock on the day before the switch (from the old software's closing stock).",
      href: tracking ? "/admin/books/stock" : "/admin/books/opening",
      cta: tracking ? "Count stock" : "Enter it",
    },
    {
      key: "lock",
      title: "Lock the old period",
      state: dayBefore && lockedUntil && lockedUntil >= dayBefore ? "done" : "todo",
      text:
        dayBefore && lockedUntil && lockedUntil >= dayBefore
          ? `Locked up to ${showDay(lockedUntil)}: nothing can be entered before the switch.`
          : dayBefore
            ? `Once the opening balances agree, lock the books up to ${showDay(dayBefore)} so nobody enters anything before the switch (Books home → Lock).`
            : "After the switch day is set and the balances agree, lock the books up to the day before it.",
      href: "/admin/books",
      cta: "Lock",
    },
    {
      key: "parallel",
      title: "Parallel run",
      state: "check",
      text: "For the first month or two, compare the trial balance, debtors, creditors and stock with the old software on the same day (the parallel run below). Stop the old software once they agree.",
      href: "#parallel",
      cta: "Compare",
    },
  ];
  return { startOn: v.startOn, today, steps, done: steps.filter((s) => s.state === "done").length, opening: v };
}

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ───────────────────────────── A10.2 the old trial balance ─────────────────────────────

export const OLD_TB_TEMPLATE = {
  columns: ["account", "debit", "credit", "maps_to", "group"],
  example: [
    ["Cash in hand", "25000", "", "", ""],
    ["HDFC Bank current account", "412500.50", "", "", ""],
    ["Sundry Debtors", "1850000", "", "debtors", ""],
    ["Sundry Creditors", "", "1240000", "creditors", ""],
    ["Closing Stock", "2200000", "", "stock", ""],
    ["Capital Account", "", "3247500.50", "", "CAPITAL"],
  ],
};

export type OldTarget =
  | { kind: "ACCOUNT"; code: string; name: string }
  | { kind: "NEW"; group: AccountGroup }
  | { kind: "DEBTORS" | "CREDITORS" | "STOCK" | "SKIP" }
  | { kind: "UNMATCHED"; why: string };
export type OldTbRow = { row: number; name: string; amount: number; target: OldTarget };

const KEYWORD: Record<string, "DEBTORS" | "CREDITORS" | "STOCK" | "SKIP"> = {
  debtors: "DEBTORS",
  "sundry debtors": "DEBTORS",
  creditors: "CREDITORS",
  "sundry creditors": "CREDITORS",
  stock: "STOCK",
  "opening stock": "STOCK",
  "closing stock": "STOCK",
  skip: "SKIP",
};
const ALIASES: Record<string, string> = {
  cash: "OFFICE_CASH",
  "cash in hand": "OFFICE_CASH",
  "cash on hand": "OFFICE_CASH",
  "office cash": "OFFICE_CASH",
  "petty cash": "OFFICE_CASH",
  "input gst": "GST_INPUT",
  "gst input": "GST_INPUT",
  "input tax credit": "GST_INPUT",
  "output gst": "GST_OUTPUT",
  "gst output": "GST_OUTPUT",
  "gst payable": "GST_OUTPUT",
  "tds payable": "TDS_PAYABLE",
  "tds receivable": "TDS_RECEIVABLE",
};

function groupOf(raw: string): AccountGroup | null {
  const t = norm(raw);
  if (!t) return null;
  for (const g of HEAD_GROUPS) if (norm(g) === t || norm(GROUPS[g].label) === t) return g;
  return null;
}

/** The old trial balance sheet → rows matched to our accounts (by name, maps_to, or a keyword). */
export async function readOldTb(ctx: Ctx, rows: Row[]) {
  const v = await openingView(ctx);
  const byName = new Map<string, { code: string; name: string }>();
  for (const a of v.accounts) {
    byName.set(norm(a.name), { code: a.code, name: a.name });
    byName.set(norm(a.code), { code: a.code, name: a.name });
  }
  const errors: RowError[] = [];
  const out: OldTbRow[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    const name = (r.account ?? r.name ?? "").trim().replace(/\s+/g, " ");
    if (!name) {
      if (Object.values(r).some((x) => (x ?? "").trim())) errors.push({ row, message: "Missing account" });
      return;
    }
    let amount: number;
    try {
      amount = (r.amount ?? "").trim() ? money(r.amount) : money(r.debit) - money(r.credit);
    } catch {
      return errors.push({ row, message: "debit and credit must be amounts in rupees" });
    }
    if (/^(total|grand total|difference)/i.test(name)) return; // the old report's own total lines
    const want = (r.maps_to ?? "").trim();
    const group = (r.group ?? "").trim();
    const look = (k: string) => {
      const n = norm(k);
      const code = ALIASES[n];
      if (code) {
        const a = v.accounts.find((x) => x.code === code);
        if (a) return { code: a.code, name: a.name };
      }
      return byName.get(n) ?? null;
    };
    let target: OldTarget;
    if (want) {
      const kw = KEYWORD[norm(want)];
      const hit = kw ? null : look(want);
      if (kw) target = { kind: kw };
      else if (hit) target = { kind: "ACCOUNT", ...hit };
      else if (norm(want) === "new" && groupOf(group)) target = { kind: "NEW", group: groupOf(group)! };
      else target = { kind: "UNMATCHED", why: `maps_to "${want}" is not one of our accounts (or debtors, creditors, stock, skip, new)` };
    } else {
      const hit = look(name);
      const n = norm(name);
      if (hit) target = { kind: "ACCOUNT", ...hit };
      else if (/debtor|receivable/.test(n)) target = { kind: "DEBTORS" };
      else if (/creditor/.test(n)) target = { kind: "CREDITORS" };
      else if (/\bstock\b/.test(n)) target = { kind: "STOCK" };
      else if (groupOf(group)) target = { kind: "NEW", group: groupOf(group)! };
      else target = { kind: "UNMATCHED", why: "No account by this name: fill maps_to with one of ours, or a group to add it as a new head" };
    }
    out.push({ row, name, amount, target });
  });
  return { rows: out, errors, opening: v };
}

/** The checks on the old trial balance: balanced, every row placed, and the debtors, creditors and stock against the open bills and stock here. */
export function checkOldTb(rows: OldTbRow[], v: Awaited<ReturnType<typeof openingView>>) {
  const sum = (k: OldTarget["kind"]) => rows.filter((r) => r.target.kind === k).reduce((a, r) => a + r.amount, 0);
  const debit = rows.reduce((a, r) => a + Math.max(0, r.amount), 0);
  const credit = rows.reduce((a, r) => a + Math.max(0, -r.amount), 0);
  const debtors = { old: sum("DEBTORS"), here: v.shops.dues - v.shops.advances };
  const creditors = { old: -sum("CREDITORS"), here: v.suppliers.owed };
  const stockRows = rows.some((r) => r.target.kind === "STOCK");
  const stock = { old: sum("STOCK"), here: v.openingStock };
  const unmatched = rows.filter((r) => r.target.kind === "UNMATCHED");
  // Each of our accounts: the sheet's figure against what is entered now.
  const accounts = new Map<string, { code: string; name: string; old: number; here: number }>();
  for (const r of rows) {
    if (r.target.kind !== "ACCOUNT") continue;
    const { code, name } = r.target;
    const cur = accounts.get(code) ?? { code, name, old: 0, here: v.accounts.find((a) => a.code === code)?.amount ?? 0 };
    cur.old += r.amount;
    accounts.set(code, cur);
  }
  const checks = [
    { key: "balanced", ok: debit === credit, text: debit === credit ? `The sheet balances: ${inr(debit)} each side.` : `The sheet doesn't balance: debits ${inr(debit)}, credits ${inr(credit)} (out by ${inr(Math.abs(debit - credit))}).` },
    {
      key: "placed",
      ok: !unmatched.length,
      text: unmatched.length ? `${unmatched.length} line${unmatched.length === 1 ? "" : "s"} not matched to our accounts: fill maps_to or group.` : "Every line has a place here.",
    },
    {
      key: "debtors",
      ok: debtors.old === debtors.here,
      text:
        debtors.old === debtors.here
          ? `Debtors ${inr(debtors.old)} agree with the shops' open bills.`
          : `Debtors ${inr(debtors.old)} in the sheet, ${inr(debtors.here)} in the shops' open bills here (out by ${inr(Math.abs(debtors.old - debtors.here))}). Import or fix the open bills.`,
    },
    {
      key: "creditors",
      ok: creditors.old === creditors.here,
      text:
        creditors.old === creditors.here
          ? `Creditors ${inr(creditors.old)} agree with the suppliers' open bills.`
          : `Creditors ${inr(creditors.old)} in the sheet, ${inr(creditors.here)} in the suppliers' open bills here (out by ${inr(Math.abs(creditors.old - creditors.here))}). Import or fix their open bills.`,
    },
    {
      key: "stock",
      ok: !stockRows || stock.here === null || stock.old === stock.here,
      text: !stockRows
        ? "No stock line in the sheet: enter the opening stock on the opening balances page."
        : stock.here === null || stock.old === stock.here
          ? `Stock ${inr(stock.old)}${stock.here === null ? " will be the opening stock." : " agrees."}`
          : `Stock ${inr(stock.old)} in the sheet, opening stock ${inr(stock.here)} here; using the sheet replaces it.`,
    },
  ];
  return {
    rows,
    accounts: [...accounts.values()],
    debit,
    credit,
    debtors,
    creditors,
    stock: { ...stock, inSheet: stockRows },
    checks,
    /** Can be used as the opening balances (debtors, creditors and stock may still need their bills / count). */
    ready: debit === credit && !unmatched.length,
    agrees: checks.every((c) => c.ok),
  };
}

/** Use the sheet as the opening balances on the switch day (replaces what was entered; new heads are added). */
export async function applyOldTb(ctx: Ctx, rows: OldTbRow[], startOn: string) {
  if (!isDay(startOn)) throw new MoneyError("Pick the day the books start here");
  const v = await openingView(ctx);
  const c = checkOldTb(rows, v);
  if (!c.ready) throw new MoneyError(c.checks.find((x) => !x.ok && (x.key === "balanced" || x.key === "placed"))!.text);
  const lines = new Map<string, number>();
  for (const r of rows) {
    if (r.target.kind === "ACCOUNT") lines.set(r.target.code, (lines.get(r.target.code) ?? 0) + r.amount);
    else if (r.target.kind === "NEW") {
      const existing = await ctx.tx.ledgerHead.findFirst({ where: { name: { equals: r.name, mode: "insensitive" } } });
      const h = existing ?? (await createHead(ctx, { name: r.name, group: r.target.group, note: "From the old trial balance" }));
      const code = `HEAD:${h.id}`;
      lines.set(code, (lines.get(code) ?? 0) + r.amount);
    }
  }
  return saveOpening(ctx, {
    startOn,
    openingStock: c.stock.inSheet ? Math.max(0, c.stock.old) : v.openingStock,
    lines: [...lines].map(([code, amount]) => ({ code, amount })),
  });
}

// ───────────────────────────── A10.3 parallel run ─────────────────────────────

export const PARALLEL_TEMPLATE = {
  columns: ["report", "name", "debit", "credit", "amount"],
  example: [
    ["trial balance", "Cash in hand", "18250", "", ""],
    ["trial balance", "Sundry Creditors", "", "1310000", ""],
    ["debtors", "Shree Ganesh Kirana", "", "", "9520"],
    ["creditors", "Chaiwala Foods Pvt Ltd", "", "", "48250"],
    ["stock", "Masala Chai 250g", "", "", "12400"],
  ],
};

export type ParallelLine = { name: string; here: number | null; old: number | null; diff: number };
export type ParallelPart = { key: "tb" | "debtors" | "creditors" | "stock"; title: string; lines: ParallelLine[]; here: number; old: number; sent: boolean };

const REPORT: Record<string, ParallelPart["key"]> = {
  tb: "tb",
  "trial balance": "tb",
  trialbalance: "tb",
  debtors: "debtors",
  "sundry debtors": "debtors",
  creditors: "creditors",
  "sundry creditors": "creditors",
  stock: "stock",
  "stock summary": "stock",
};

/** Shops' balances on a day: dues less unused money (advances), by shop. */
export async function debtorsOn(ctx: Ctx, asOn: string) {
  const sums = await ctx.tx.ledgerLine.groupBy({
    by: ["accountId"],
    where: { account: { type: { in: ["RECEIVABLE", "WALLET"] } }, entry: { occurredAt: { lte: dayEnd(asOn) } } },
    _sum: { amount: true },
  });
  const accs = sums.length
    ? await ctx.tx.ledgerAccount.findMany({
        where: { id: { in: sums.map((s) => s.accountId) } },
        select: { id: true, type: true, retailerId: true, retailer: { select: { outletName: true, user: { select: { phone: true } } } } },
      })
    : [];
  const shops = new Map<string, { name: string; phone: string; dues: number; advance: number }>();
  for (const s of sums) {
    const a = accs.find((x) => x.id === s.accountId);
    if (!a?.retailerId) continue;
    const r = shops.get(a.retailerId) ?? { name: a.retailer?.outletName ?? "Shop", phone: a.retailer?.user?.phone ?? "", dues: 0, advance: 0 };
    if (a.type === "RECEIVABLE") r.dues += Number(s._sum.amount ?? 0);
    else r.advance -= Number(s._sum.amount ?? 0);
    shops.set(a.retailerId, r);
  }
  return [...shops.values()].filter((r) => r.dues || r.advance).sort((a, b) => b.dues - b.advance - (a.dues - a.advance));
}

function compare(key: ParallelPart["key"], title: string, here: { name: string; amount: number }[], old: { name: string; amount: number }[], sent: boolean): ParallelPart {
  const m = new Map<string, ParallelLine>();
  for (const h of here) {
    const k = norm(h.name);
    const cur = m.get(k) ?? { name: h.name, here: 0, old: null, diff: 0 };
    cur.here = (cur.here ?? 0) + h.amount;
    m.set(k, cur);
  }
  for (const o of old) {
    const k = norm(o.name);
    const cur = m.get(k) ?? { name: o.name, here: null, old: 0, diff: 0 };
    cur.old = (cur.old ?? 0) + o.amount;
    m.set(k, cur);
  }
  const lines = [...m.values()]
    .map((l) => ({ ...l, diff: (l.here ?? 0) - (l.old ?? 0) }))
    .filter((l) => (l.here ?? 0) !== 0 || (l.old ?? 0) !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name));
  return { key, title, lines, here: here.reduce((a, x) => a + x.amount, 0), old: old.reduce((a, x) => a + x.amount, 0), sent };
}

/** Our figures on a day against the old software's (the sheet), report by report. */
export async function parallelRun(ctx: Ctx, day: string, rows: Row[]) {
  if (!isDay(day)) throw new MoneyError("Pick the day the figures are for");
  if (day > todayIst()) throw new MoneyError("Pick today or an earlier day");
  const errors: RowError[] = [];
  const old: Record<ParallelPart["key"], { name: string; amount: number }[]> = { tb: [], debtors: [], creditors: [], stock: [] };
  rows.forEach((r, i) => {
    const row = i + 2;
    const rep = REPORT[norm(r.report ?? "")];
    const name = (r.name ?? r.account ?? "").trim().replace(/\s+/g, " ");
    if (!rep) return errors.push({ row, message: `report must be trial balance, debtors, creditors or stock (not "${r.report ?? ""}")` });
    if (!name) return errors.push({ row, message: "Missing name" });
    if (/^(total|grand total)$/i.test(name)) return;
    try {
      const amount = (r.amount ?? "").trim() ? money(r.amount) : money(r.debit) - money(r.credit);
      old[rep].push({ name, amount });
    } catch {
      errors.push({ row, message: "Amounts must be in rupees" });
    }
  });

  // Trial balance: ours on the day (from the start of its year), shops and suppliers rolled up as the old one has them.
  const tb = await trialBalance(ctx, fyStart(day), day);
  const tbHere: { name: string; amount: number }[] = [];
  let debtorsNet = 0;
  for (const g of tb.groups)
    for (const r of g.rows) {
      if (r.key === "RECEIVABLE" || r.key === "WALLET") debtorsNet += r.closing;
      else if (r.key === "PAYABLE") tbHere.push({ name: "Sundry creditors", amount: r.closing });
      else if (r.closing) tbHere.push({ name: r.name, amount: r.closing });
    }
  if (debtorsNet) tbHere.push({ name: "Sundry debtors", amount: debtorsNet });
  // The old sheet's names for the same lines.
  const tbOld = old.tb.map((o) => {
    const n = norm(o.name);
    if (ALIASES[n] === "OFFICE_CASH") return { ...o, name: tbHere.find((h) => /cash/i.test(h.name) && /office/i.test(h.name))?.name ?? o.name };
    if (/debtor/.test(n)) return { ...o, name: "Sundry debtors" };
    if (/creditor/.test(n)) return { ...o, name: "Sundry creditors" };
    return o;
  });

  const debtors = (await debtorsOn(ctx, day)).map((d) => ({ name: d.name, amount: d.dues - d.advance }));
  const creditors = (await payablesBySupplier(ctx, day)).rows.map((s) => ({ name: s.name, amount: s.owed }));
  const tracking = await stockOn(ctx);
  const stock = tracking ? (await stockValuation(ctx, { day, by: "product" })).rows.map((s) => ({ name: s.name, amount: s.value })) : [];

  const parts: ParallelPart[] = [
    compare("tb", "Trial balance (debit +, credit −)", tbHere, tbOld, old.tb.length > 0),
    compare("debtors", "Debtors (shops)", debtors, old.debtors, old.debtors.length > 0),
    compare("creditors", "Creditors (suppliers)", creditors, old.creditors, old.creditors.length > 0),
    compare("stock", tracking ? "Stock value" : "Stock value (stock tracking is off here)", stock, old.stock, old.stock.length > 0),
  ];
  return { day, parts, errors, agrees: parts.every((p) => !p.sent || p.lines.every((l) => l.diff === 0)) };
}
