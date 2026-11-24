import ExcelJS from "exceljs";
import { formatINR } from "@/lib/money";
import { renderSheetPdf, type Sheet, type SheetRow } from "@/lib/dues-export";
import { accountLabel, dayBook, dayEnd, dayStart, GROUP_ORDER, GROUPS, showDay } from "@/lib/books";
import { dayBookCsv, drcr, purchaseRegisterCsv } from "@/lib/books-export";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/final-accounts";
import { cashBook, cashBookChoices } from "@/lib/vouchers";
import { cashBookCsv } from "@/lib/vouchers-export";
import { purchaseRegister } from "@/lib/purchases";
import { payablesBySupplier } from "@/lib/supplier-payments";
import { bySupplierCsv } from "@/lib/payables-export";
import { pendingClaims } from "@/lib/claims";
import { pendingCsv } from "@/lib/claims-export";
import { countList, stockChoices, stockValuation } from "@/lib/stock-counts";
import { valuationCsv } from "@/lib/stock-counts-export";
import { salesRegisterWorkbook, type ExportDoc } from "@/lib/gst-exports";
import { zip, type ZipFile } from "@/lib/zip";
import { gstMonth, itcRegister } from "@/lib/gst-returns";
import { itcCsv, monthsCsv } from "@/lib/gst-returns-export";
import { periodOf, shiftPeriod } from "@/lib/gst-math";
import { tdsReceived, tdsRegister } from "@/lib/tds";
import { debtorsOn } from "@/lib/switch-over";
import { receivedCsv, registerCsv } from "@/lib/tds-export";
import type { AccountGroup } from "@/generated/prisma/client";
import type { Ctx } from "@/lib/ledger";

/** PDF / CSV of the final accounts, and the CA pack (one zip for a period). */

type TB = Awaited<ReturnType<typeof trialBalance>>;
type PL = Awaited<ReturnType<typeof profitAndLoss>>;
type BS = Awaited<ReturnType<typeof balanceSheet>>;
type Cell = string | number | null;

const rupees = (p: number) => (p / 100).toFixed(2);
const amt = (p: number) => (p ? formatINR(p) : "");
const signed = (p: number) => (p < 0 ? `(${formatINR(-p)})` : formatINR(p));
const between = (from: string, to: string) => `${showDay(from)} to ${showDay(to)}`;
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

// ───────────────────────────── trial balance ─────────────────────────────

export function tbSheet(t: TB): Sheet {
  const rows: SheetRow[] = [];
  const dc = (p: number) => (p ? drcr(p) : "");
  for (const g of t.groups) {
    rows.push({ kind: "group", text: g.label });
    for (const r of g.rows) rows.push({ kind: "row", cells: [`${r.name}${r.count ? ` (${r.count})` : ""}`, dc(r.opening), amt(r.debit), amt(r.credit), dc(r.closing)] });
    rows.push({ kind: "sub", cells: [`Total ${g.label.toLowerCase()}`, dc(g.opening), amt(g.debit), amt(g.credit), dc(g.closing)] });
  }
  rows.push({ kind: "total", cells: ["Total", `${formatINR(t.totals.openingDr)} Dr`, formatINR(t.totals.debit), formatINR(t.totals.credit), `${formatINR(t.totals.closingDr)} Dr`] });
  rows.push({ kind: "total", cells: ["", `${formatINR(t.totals.openingCr)} Cr`, "", "", `${formatINR(t.totals.closingCr)} Cr`] });
  if (t.difference) rows.push({ kind: "note", text: `Out by ${drcr(t.difference)}. Run Books → Check my books.` });
  return {
    title: "Trial balance",
    subtitle: `${between(t.from, t.to)} · shops', staff and suppliers' accounts shown as one line each`,
    landscape: true,
    cols: [
      { label: "Account", width: 300, wrap: true },
      { label: "Opening", width: 110, align: "r" },
      { label: "Debit", width: 100, align: "r" },
      { label: "Credit", width: 100, align: "r" },
      { label: "Closing", width: 110, align: "r" },
    ],
    rows,
  };
}

const dcCsv = (p: number) => (p === 0 ? "0.00" : `${rupees(Math.abs(p))} ${p > 0 ? "Dr" : "Cr"}`);
export function tbCsv(t: TB): Cell[][] {
  return [
    ["Group", "Account", "Accounts", "Opening", "Debit", "Credit", "Closing"],
    ...t.groups.flatMap((g) => g.rows.map((r) => [g.label, r.name, r.count ?? 1, dcCsv(r.opening), rupees(r.debit), rupees(r.credit), dcCsv(r.closing)])),
    [
      "",
      "Total",
      "",
      `${rupees(t.totals.openingDr)} Dr / ${rupees(t.totals.openingCr)} Cr`,
      rupees(t.totals.debit),
      rupees(t.totals.credit),
      `${rupees(t.totals.closingDr)} Dr / ${rupees(t.totals.closingCr)} Cr`,
    ],
  ];
}

// ───────────────────────────── profit and loss ─────────────────────────────

/** The P&L as rows of [particulars, amount, kind] (shared by the PDF, CSV and page). */
export function plRows(p: PL): { kind: "group" | "row" | "sub" | "total"; label: string; amount: number | null }[] {
  const out: { kind: "group" | "row" | "sub" | "total"; label: string; amount: number | null }[] = [];
  const push = (kind: "group" | "row" | "sub" | "total", label: string, amount: number | null = null) => out.push({ kind, label, amount });
  push("group", "Trading");
  push("row", "Sales", p.sales.gross);
  if (p.sales.returns) push("row", "Less returns and cancellations", -p.sales.returns);
  push("sub", "Net sales", p.sales.net);
  push("row", "Opening stock", p.openingStock);
  for (const l of p.purchases.lines) push("row", l.name, l.amount);
  push("row", "Less closing stock", -p.closingStock);
  push("sub", "Cost of goods sold", p.costOfGoods);
  for (const l of p.direct.lines) push("row", l.name, l.amount);
  if (p.direct.lines.length) push("sub", "Direct expenses", p.direct.total);
  push("total", p.grossProfit >= 0 ? "Gross profit" : "Gross loss", p.grossProfit);
  push("group", "Running the business");
  for (const l of p.indirect.lines) push("row", l.name, l.amount);
  push("sub", "Expenses", p.indirect.total);
  for (const l of p.otherIncome.lines) push("row", l.name, l.amount);
  if (p.otherIncome.lines.length) push("sub", "Other income", p.otherIncome.total);
  push("total", p.netProfit >= 0 ? "Net profit" : "Net loss", p.netProfit);
  return out;
}

export function plSheet(p: PL): Sheet {
  const rows: SheetRow[] = plRows(p).map((r) => (r.kind === "group" ? { kind: "group", text: r.label } : { kind: r.kind, cells: [r.label, r.amount === null ? "" : signed(r.amount)] }));
  if (p.lastYear)
    rows.push({
      kind: "note",
      text: `Same period last year (${between(p.lastYear.from, p.lastYear.to)}): net sales ${formatINR(p.lastYear.salesNet)}, gross profit ${signed(p.lastYear.grossProfit)}, net profit ${signed(p.lastYear.netProfit)}.`,
    });
  for (const w of p.warnings) rows.push({ kind: "note", text: w });
  return {
    title: "Profit and loss",
    subtitle: `${between(p.from, p.to)} · stock at cost; purchases are cost when bought, so stock is added back`,
    landscape: false,
    cols: [
      { label: "Particulars", width: 360, wrap: true },
      { label: "Amount", width: 120, align: "r" },
    ],
    rows,
  };
}

export function plMonthsSheet(p: PL): Sheet {
  const ms = p.months ?? [];
  const sum = (k: "sales" | "purchases" | "grossProfit" | "running" | "netProfit") => ms.reduce((a, m) => a + m[k], 0);
  return {
    title: "Profit and loss by month",
    subtitle: between(p.from, p.to),
    landscape: true,
    cols: [
      { label: "Month", width: 110 },
      { label: "Net sales", width: 110, align: "r" },
      { label: "Purchases", width: 110, align: "r" },
      { label: "Closing stock", width: 110, align: "r" },
      { label: "Gross profit", width: 110, align: "r" },
      { label: "Expenses less other income", width: 130, align: "r" },
      { label: "Net profit", width: 110, align: "r" },
    ],
    rows: [
      ...ms.map((m) => ({
        kind: "row" as const,
        cells: [monthName(m.month), formatINR(m.sales), formatINR(m.purchases), formatINR(m.closingStock), signed(m.grossProfit), signed(m.running), signed(m.netProfit)],
      })),
      { kind: "total", cells: ["Total", formatINR(sum("sales")), formatINR(sum("purchases")), "", signed(sum("grossProfit")), signed(sum("running")), signed(sum("netProfit"))] },
    ],
  };
}

export function plCsv(p: PL): Cell[][] {
  const rows: Cell[][] = [["Particulars", "Amount"], ...plRows(p).map((r) => [r.kind === "group" ? r.label.toUpperCase() : r.label, r.amount === null ? "" : rupees(r.amount)])];
  if (p.months?.length) {
    rows.push([], ["Month", "Net sales", "Purchases", "Opening stock", "Closing stock", "Gross profit", "Expenses less other income", "Net profit"]);
    for (const m of p.months) rows.push([m.month, rupees(m.sales), rupees(m.purchases), rupees(m.openingStock), rupees(m.closingStock), rupees(m.grossProfit), rupees(m.running), rupees(m.netProfit)]);
  }
  if (p.lastYear)
    rows.push(
      [],
      ["Last year", `${p.lastYear.from} to ${p.lastYear.to}`],
      ["Net sales", rupees(p.lastYear.salesNet)],
      ["Gross profit", rupees(p.lastYear.grossProfit)],
      ["Net profit", rupees(p.lastYear.netProfit)],
    );
  return rows;
}

// ───────────────────────────── balance sheet ─────────────────────────────

export function bsSheet(b: BS): Sheet {
  const rows: SheetRow[] = [];
  const side = (title: string, secs: BS["assets"], total: number) => {
    rows.push({ kind: "group", text: title });
    for (const s of secs) {
      rows.push({ kind: "group2", text: s.label, right: signed(s.total) });
      for (const l of s.lines) rows.push({ kind: "row", cells: [`${l.name}${l.count ? ` (${l.count})` : ""}`, signed(l.amount)] });
    }
    rows.push({ kind: "total", cells: [`Total ${title.toLowerCase()}`, formatINR(total)] });
  };
  side("Capital and liabilities", b.liabilities, b.totalLiabilities);
  side("Assets", b.assets, b.totalAssets);
  if (b.difference) {
    rows.push({ kind: "note", text: `Does not balance: out by ${formatINR(Math.abs(b.difference))}.` });
    for (const f of b.failing) rows.push({ kind: "note", text: `${f.title}: ${f.detail}` });
  }
  if (b.stock.warning) rows.push({ kind: "note", text: `Stock: ${b.stock.warning}` });
  return {
    title: "Balance sheet",
    subtitle: `As at the end of ${showDay(b.asOn)}`,
    landscape: false,
    cols: [
      { label: "Particulars", width: 360, wrap: true },
      { label: "Amount", width: 120, align: "r" },
    ],
    rows,
  };
}

export function bsCsv(b: BS): Cell[][] {
  const out: Cell[][] = [["Side", "Section", "Particulars", "Amount"]];
  for (const s of b.liabilities) for (const l of s.lines) out.push(["Capital and liabilities", s.label, l.name, rupees(l.amount)]);
  out.push(["Capital and liabilities", "", "Total", rupees(b.totalLiabilities)]);
  for (const s of b.assets) for (const l of s.lines) out.push(["Assets", s.label, l.name, rupees(l.amount)]);
  out.push(["Assets", "", "Total", rupees(b.totalAssets)]);
  if (b.difference) out.push(["", "", "Difference", rupees(b.difference)]);
  return out;
}

// ───────────────────────────── every ledger ─────────────────────────────

const LEDGER_CAP = 200_000;

/** Every account's ledger for a period, one after another (shops, staff and suppliers each on their own). */
async function allLedgers(ctx: Ctx, from: string, to: string): Promise<Cell[][]> {
  const start = dayStart(from);
  const end = dayEnd(to);
  const [opening, lines, accounts] = await Promise.all([
    ctx.tx.ledgerLine.groupBy({ by: ["accountId"], where: { entry: { occurredAt: { lt: start } } }, _sum: { amount: true } }),
    ctx.tx.ledgerLine.findMany({
      where: { entry: { occurredAt: { gte: start, lte: end } } },
      select: { accountId: true, amount: true, entry: { select: { occurredAt: true, kind: true, memo: true } } },
      orderBy: [{ entry: { occurredAt: "asc" } }, { id: "asc" }],
      take: LEDGER_CAP + 1,
    }),
    ctx.tx.ledgerAccount.findMany({
      select: { id: true, code: true, type: true, name: true, group: true, userId: true, retailerId: true, retailer: { select: { outletName: true } }, supplier: { select: { name: true } } },
    }),
  ]);
  const userIds = [...new Set(accounts.map((a) => a.userId).filter((x): x is string => !!x))];
  const users = new Map((userIds.length ? await ctx.tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : []).map((u) => [u.id, u.name]));
  const open = new Map(opening.map((o) => [o.accountId, Number(o._sum.amount ?? 0)]));
  const by = new Map<string, typeof lines>();
  for (const l of lines.slice(0, LEDGER_CAP)) by.set(l.accountId, [...(by.get(l.accountId) ?? []), l]);
  const order = (g: AccountGroup) => GROUP_ORDER.indexOf(g);
  const named = accounts.map((a) => ({ ...a, label: accountLabel(a, users) })).sort((x, y) => order(x.group) - order(y.group) || x.label.localeCompare(y.label));
  const out: Cell[][] = [["Group", "Account", "Date", "Entry", "Memo", "Debit", "Credit", "Balance"]];
  for (const a of named) {
    const ls = by.get(a.id) ?? [];
    let bal = open.get(a.id) ?? 0;
    if (!ls.length && !bal) continue;
    out.push([GROUPS[a.group].label, a.label, from, "Opening", "", "", "", dcCsv(bal)]);
    for (const l of ls) {
      bal += l.amount;
      const day = new Date(l.entry.occurredAt.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      out.push([GROUPS[a.group].label, a.label, day, l.entry.kind, l.entry.memo ?? "", l.amount > 0 ? rupees(l.amount) : "", l.amount < 0 ? rupees(-l.amount) : "", dcCsv(bal)]);
    }
  }
  if (lines.length > LEDGER_CAP) out.push(["", `Only the first ${LEDGER_CAP.toLocaleString("en-IN")} lines are here; make the pack for a shorter period for the rest.`]);
  return out;
}

// ───────────────────────────── CA pack ─────────────────────────────

/** Debtors as at a day: each shop's dues and unused money (advances) from its accounts. */
async function debtors(ctx: Ctx, asOn: string): Promise<Cell[][]> {
  const rows = await debtorsOn(ctx, asOn);
  return [
    ["Shop", "Phone", "Dues", "Unused money (advance)", "Net"],
    ...rows.map((r) => [r.name, r.phone, rupees(r.dues), rupees(r.advance), rupees(r.dues - r.advance)]),
    ["Total", "", rupees(rows.reduce((a, r) => a + r.dues, 0)), rupees(rows.reduce((a, r) => a + r.advance, 0)), rupees(rows.reduce((a, r) => a + r.dues - r.advance, 0))],
  ];
}

function addSheet(wb: ExcelJS.Workbook, name: string, rows: Cell[][]) {
  const ws = wb.addWorksheet(name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  for (const r of rows) ws.addRow(r.map((c) => (typeof c === "string" && /^-?\d+\.\d{2}$/.test(c) ? Number(c) : c)));
  const head = ws.getRow(1);
  head.font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.columns.forEach((c) => (c.width = 16));
  return ws;
}

/** Everything the CA pack is made from, read in one go (inside the books' transaction). */
export async function caPackData(ctx: Ctx, from: string, to: string) {
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { name: true, legalName: true, address: true, gstin: true } });
  const tb = await trialBalance(ctx, from, to);
  const pl = await profitAndLoss(ctx, from, to, { months: true, compare: true });
  const bs = await balanceSheet(ctx, to);
  const books = await cashBookChoices(ctx);
  const cash: { name: string; book: Awaited<ReturnType<typeof cashBook>> }[] = [];
  for (const c of [...books.cash, ...books.banks]) {
    const b = await cashBook(ctx, c.code, from, to);
    if (b.days.length || b.opening || b.closing) cash.push({ name: c.name, book: b });
  }
  const choices = await stockChoices(ctx);
  const docs = (await ctx.tx.invoice.findMany({
    where: { date: { gte: dayStart(from), lte: dayEnd(to) } },
    orderBy: [{ date: "asc" }, { number: "asc" }],
    include: { lines: { orderBy: { sl: "asc" } }, original: { select: { id: true, number: true, date: true, b2b: true, interState: true, total: true } }, order: { select: { orderNumber: true } } },
  })) as ExportDoc[];
  // GSTR-3B of each month the period touches.
  const gst = [];
  for (let p = periodOf(from); p <= periodOf(to) && gst.length < 14; p = shiftPeriod(p, 1)) gst.push(await gstMonth(ctx, p));
  return {
    from,
    to,
    biz: { name: t.legalName || t.name, address: t.address, gstin: t.gstin },
    tb,
    pl,
    bs,
    dayBook: dayBookCsv(await dayBook(ctx, from, to)),
    ledgers: await allLedgers(ctx, from, to),
    cash,
    purchases: purchaseRegisterCsv(await purchaseRegister(ctx, from, to)),
    debtors: await debtors(ctx, to),
    creditors: bySupplierCsv(await payablesBySupplier(ctx, to)),
    claims: pendingCsv(await pendingClaims(ctx, to)),
    stock: choices.tracking ? valuationCsv(await stockValuation(ctx, { day: to, by: "product" })) : null,
    counts: (await countList(ctx)).filter((c) => c.date >= from && c.date <= to),
    docs,
    gst,
    itc: await itcRegister(ctx, from, to),
    tds: registerCsv(await tdsRegister(ctx, from, to)),
    tdsChallans: await challansCsv(ctx, from, to),
    tdsReceived: receivedCsv(await tdsReceived(ctx, from, to)),
  };
}

/** TDS challans paid in the period (cancelled ones marked). */
async function challansCsv(ctx: Ctx, from: string, to: string): Promise<Cell[][]> {
  const list = await ctx.tx.tdsChallan.findMany({ where: { paidOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, include: { bankAccount: { select: { name: true } } }, orderBy: [{ paidOn: "asc" }, { number: "asc" }] });
  return [
    ["Number", "Paid on", "Section", "For month", "BSR code", "Challan serial", "Tax", "Interest", "Late fee", "Bank", "Status"],
    ...list.map((c) => [c.number, c.paidOn.toISOString().slice(0, 10), c.section, c.period, c.bsrCode, c.serial, rupees(c.tax), rupees(c.interest), rupees(c.lateFee), c.bankAccount?.name ?? "", c.cancelledAt ? `Cancelled: ${c.cancelReason ?? ""}` : "Paid"]),
  ];
}

/**
 * The CA pack: trial balance, P&L (with months) and balance sheet as PDFs;
 * one workbook with those plus the day book, every ledger, cash and bank
 * books, purchase register, debtors, creditors, claims and stock; and the
 * sales register workbook. Made outside the transaction (PDFs take a while).
 */
export async function buildCaPack(d: Awaited<ReturnType<typeof caPackData>>) {
  const { from, to, biz, tb, pl, bs } = d;
  const files: ZipFile[] = [];
  const pdf = async (name: string, s: Sheet) => files.push({ name, data: await renderSheetPdf(s, biz) });
  await pdf("01 Trial balance.pdf", tbSheet(tb));
  await pdf("02 Profit and loss.pdf", plSheet(pl));
  await pdf("03 Profit and loss by month.pdf", plMonthsSheet(pl));
  await pdf("04 Balance sheet.pdf", bsSheet(bs));

  const wb = new ExcelJS.Workbook();
  wb.creator = "VBiz Pro";
  addSheet(wb, "Trial balance", tbCsv(tb));
  addSheet(wb, "Profit and loss", plCsv(pl));
  addSheet(wb, "Balance sheet", bsCsv(bs));
  addSheet(wb, "Day book", d.dayBook);
  addSheet(wb, "Ledgers", d.ledgers);
  const cashRows: Cell[][] = d.cash.flatMap((c) => [[c.name], ...cashBookCsv(c.book), []]);
  addSheet(wb, "Cash and bank books", cashRows.length ? cashRows : [["No cash or bank entries in this period"]]);
  addSheet(wb, "Purchase register", d.purchases);
  addSheet(wb, "Debtors", d.debtors);
  addSheet(wb, "Creditors", d.creditors);
  addSheet(wb, "Claims pending", d.claims);
  if (d.stock) addSheet(wb, "Stock value", d.stock);
  addSheet(wb, "Stock counts", [
    ["Number", "Date", "What", "How", "Status", "Counted value", "Short", "Over"],
    ...d.counts.map((c) => [c.number, c.date, c.what, c.mode, c.statusLabel, rupees(c.countedValue), rupees(c.shortage), rupees(c.excess)]),
  ]);
  addSheet(wb, "GSTR-3B by month", monthsCsv(d.gst));
  addSheet(wb, "Input credit", itcCsv(d.itc));
  addSheet(wb, "TDS kept back", d.tds);
  addSheet(wb, "TDS challans", d.tdsChallans);
  addSheet(wb, "TDS kept back from us", d.tdsReceived);
  files.push({ name: `05 Books ${from} to ${to}.xlsx`, data: Buffer.from(await wb.xlsx.writeBuffer()) });
  files.push({ name: `06 Sales register ${from} to ${to}.xlsx`, data: await salesRegisterWorkbook(d.docs) });
  files.push({
    name: "README.txt",
    data: [
      `${biz.name}: books for ${between(from, to)}`,
      `Made ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} by VBiz Pro.`,
      "",
      "01-04  Trial balance, profit and loss (and by month), balance sheet (PDF).",
      "05     Workbook: the same reports, day book, every ledger, cash and bank books, purchase register,",
      "       debtors, creditors, pending claims, stock value, stock counts, the GSTR-3B working by month",
      "       (with the set-off and payment of each settled month), the input credit register, and TDS:",
      "       what we kept back, the challans paid, and what customers kept back from us.",
      "06     Sales register: invoices and notes, items, and totals by GST rate.",
      "",
      "Amounts are in rupees. Stock is at cost; closing stock is the accepted count on the day, else the app's stock at cost.",
      ...(tb.difference || bs.difference ? ["", "WARNING: the books do not balance. See the trial balance and balance sheet notes."] : []),
      ...pl.warnings.map((w) => `Note: ${w}`),
    ].join(String.fromCharCode(13, 10)),
  });
  return { bytes: zip(files), names: files.map((f) => f.name), balanced: !tb.difference && !bs.difference };
}

/** Read and build the CA pack in one call (tests; the API reads in the transaction and builds after). */
export async function caPack(ctx: Ctx, from: string, to: string) {
  return buildCaPack(await caPackData(ctx, from, to));
}
