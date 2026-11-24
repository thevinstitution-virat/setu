import { NextResponse } from "next/server";
import { formatINR } from "@/lib/money";
import { toCsv } from "@/lib/field";
import { renderSheetPdf, type Sheet, type SheetRow } from "@/lib/dues-export";
import type { TenantDb } from "@/lib/db";
import { showDay, type accountLedger, type chartOfAccounts, type dayBook } from "@/lib/books";

/** PDF and CSV of the books' reports, in the outstanding reports' style. */

type Ledger = Awaited<ReturnType<typeof accountLedger>>;
type DayBook = Awaited<ReturnType<typeof dayBook>>;
type Chart = Awaited<ReturnType<typeof chartOfAccounts>>;

const amt = (p: number) => (p ? formatINR(p) : "");
const rupees = (p: number) => (p / 100).toFixed(2);
/** Balance with its side: 1,200.00 Dr / 300.00 Cr. */
export const drcr = (p: number) => (p === 0 ? formatINR(0) : `${formatINR(Math.abs(p))} ${p > 0 ? "Dr" : "Cr"}`);
const csvDrcr = (p: number) => (p === 0 ? "0.00" : `${rupees(Math.abs(p))} ${p > 0 ? "Dr" : "Cr"}`);
const period = (from: string, to: string) => (from === to ? `On ${showDay(from)}` : `${showDay(from)} to ${showDay(to)}`);

export function ledgerSheet(l: Ledger): Sheet {
  const rows: SheetRow[] = [
    { kind: "sub", cells: [showDay(l.from), "Opening balance", "", "", "", drcr(l.opening)] },
    ...l.rows.map((r): SheetRow => ({ kind: "row", cells: [showDay(r.date), `${r.kindLabel}${r.memo ? `: ${r.memo}` : ""}`, r.against, amt(r.debit), amt(r.credit), drcr(r.balance)] })),
    { kind: "total", cells: ["", "Totals for the period", "", amt(l.debit), amt(l.credit), ""] },
    { kind: "sub", cells: [showDay(l.to), "Closing balance", "", "", "", drcr(l.closing)] },
  ];
  if (l.capped) rows.push({ kind: "note", text: "Only the first 3,000 entries are shown. Pick a shorter period for the rest." });
  return {
    title: `Ledger: ${l.name}`,
    subtitle: `${l.groupLabel} · ${period(l.from, l.to)}`,
    landscape: true,
    cols: [
      { label: "Date", width: 50 },
      { label: "Particulars", width: 210, wrap: true },
      { label: "Against", width: 150 },
      { label: "Debit", width: 70, align: "r" },
      { label: "Credit", width: 70, align: "r" },
      { label: "Balance", width: 80, align: "r" },
    ],
    rows,
  };
}

export function ledgerCsv(l: Ledger) {
  return [
    ["Date", "Type", "Particulars", "Against", "Debit", "Credit", "Balance"],
    [l.from, "", "Opening balance", "", "", "", csvDrcr(l.opening)],
    ...l.rows.map((r) => [r.date, r.kindLabel, r.memo ?? "", r.against, r.debit ? rupees(r.debit) : "", r.credit ? rupees(r.credit) : "", csvDrcr(r.balance)]),
    ["", "", "Totals for the period", "", rupees(l.debit), rupees(l.credit), ""],
    [l.to, "", "Closing balance", "", "", "", csvDrcr(l.closing)],
  ];
}

export function dayBookSheet(d: DayBook): Sheet {
  const rows: SheetRow[] = [];
  for (const e of d.entries) {
    rows.push({ kind: "group", text: `${showDay(e.date)} ${e.time} · ${e.kindLabel}${e.reversed ? " (reversed)" : ""}${e.memo ? ` · ${e.memo}` : ""}`, right: formatINR(e.total) });
    for (const l of e.lines) rows.push({ kind: "row", cells: [l.account, amt(l.debit), amt(l.credit)] });
  }
  rows.push({ kind: "total", cells: [`${d.entries.length} entries`, formatINR(d.debit), formatINR(d.credit)] });
  if (d.capped) rows.push({ kind: "note", text: "Only the first 1,000 entries are shown. Pick a shorter period for the rest." });
  return {
    title: "Day book",
    subtitle: `${period(d.from, d.to)}${d.kind ? ` · ${d.kinds[0]?.label ?? ""}` : ""}`,
    landscape: false,
    cols: [
      { label: "Account", width: 300 },
      { label: "Debit", width: 90, align: "r" },
      { label: "Credit", width: 90, align: "r" },
    ],
    rows,
  };
}

export function dayBookCsv(d: DayBook) {
  return [
    ["Date", "Time", "Type", "Memo", "Reversed", "Account", "Debit", "Credit"],
    ...d.entries.flatMap((e) => e.lines.map((l) => [e.date, e.time, e.kindLabel, e.memo ?? "", e.reversed ? "yes" : "", l.account, l.debit ? rupees(l.debit) : "", l.credit ? rupees(l.credit) : ""])),
  ];
}

export function trialSheet(c: Chart, asOn: string): Sheet {
  const rows: SheetRow[] = [];
  for (const g of c.groups) {
    rows.push({ kind: "group", text: g.label });
    for (const r of g.rows) {
      if (!r.balance) continue;
      rows.push({ kind: "row", cells: [`${r.name}${r.count ? ` (${r.count})` : ""}`, r.balance > 0 ? formatINR(r.balance) : "", r.balance < 0 ? formatINR(-r.balance) : ""] });
    }
    rows.push({ kind: "sub", cells: [`Total ${g.label.toLowerCase()}`, g.total > 0 ? formatINR(g.total) : "", g.total < 0 ? formatINR(-g.total) : ""] });
  }
  rows.push({ kind: "total", cells: ["Total", formatINR(c.debit), formatINR(c.credit)] });
  if (c.difference) rows.push({ kind: "note", text: `Difference ${drcr(c.difference)}. Run Books → Check my books.` });
  return {
    title: "Trial balance",
    subtitle: `As on ${showDay(asOn)} · shops' and staff accounts shown as one line each`,
    landscape: false,
    cols: [
      { label: "Account", width: 300 },
      { label: "Debit", width: 90, align: "r" },
      { label: "Credit", width: 90, align: "r" },
    ],
    rows,
  };
}

export function trialCsv(c: Chart) {
  return [
    ["Group", "Account", "Accounts", "Debit", "Credit"],
    ...c.groups.flatMap((g) => g.rows.filter((r) => r.balance).map((r) => [g.label, r.name, r.count ?? 1, r.balance > 0 ? rupees(r.balance) : "", r.balance < 0 ? rupees(-r.balance) : ""])),
    ["", "Total", "", rupees(c.debit), rupees(c.credit)],
  ];
}

/** The CSV or PDF response for a books report. */
export async function fileResponse(db: TenantDb, tenantId: string, format: "csv" | "pdf", file: string, csv: (string | number | null)[][], sheet: Sheet) {
  if (format === "csv") {
    return new NextResponse(toCsv(csv), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}.csv"`, "cache-control": "no-store" },
    });
  }
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, legalName: true, address: true, gstin: true } });
  const bytes = await renderSheetPdf(sheet, { name: t.legalName || t.name, address: t.address, gstin: t.gstin });
  return new NextResponse(Buffer.from(bytes), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${file}.pdf"`, "cache-control": "no-store" },
  });
}
