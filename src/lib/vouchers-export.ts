import { formatINR } from "@/lib/money";
import type { Sheet, SheetRow } from "@/lib/dues-export";
import { showDay } from "@/lib/books";
import { drcr } from "@/lib/books-export";
import { VOUCHER_METHOD_LABEL, VOUCHER_TYPE_LABEL, VOUCHER_TYPES } from "@/lib/voucher-labels";
import type { cashBook, voucherDetail, voucherList } from "@/lib/vouchers";

/** PDF and CSV of vouchers, a single voucher, and the cash and bank books. */

type List = Awaited<ReturnType<typeof voucherList>>;
type Detail = Awaited<ReturnType<typeof voucherDetail>>;
type Book = Awaited<ReturnType<typeof cashBook>>;

const amt = (p: number) => (p ? formatINR(p) : "");
const rupees = (p: number) => (p / 100).toFixed(2);
const csvDrcr = (p: number) => (p === 0 ? "0.00" : `${rupees(Math.abs(p))} ${p > 0 ? "Dr" : "Cr"}`);
const period = (from: string, to: string) => (from === to ? `On ${showDay(from)}` : `${showDay(from)} to ${showDay(to)}`);

export function voucherListSheet(l: List): Sheet {
  const rows: SheetRow[] = l.rows.map((v) => ({
    kind: "row",
    cells: [showDay(v.date), `${v.number}${v.cancelled ? " (cancelled)" : ""}`, [v.what, v.party].filter(Boolean).join(" · "), v.via, v.cancelled ? "" : formatINR(v.amount)],
  }));
  for (const t of VOUCHER_TYPES) if (l.counts[t]) rows.push({ kind: "sub", cells: ["", VOUCHER_TYPE_LABEL[t], `${l.counts[t]} vouchers`, "", formatINR(l.totals[t])] });
  if (l.capped) rows.push({ kind: "note", text: "Only the first 3,000 vouchers are shown. Pick a shorter period for the rest." });
  return {
    title: l.type ? `${VOUCHER_TYPE_LABEL[l.type]}s` : "Vouchers",
    subtitle: `${period(l.from, l.to)}${l.q ? ` · "${l.q}"` : ""}`,
    landscape: true,
    cols: [
      { label: "Date", width: 50 },
      { label: "Number", width: 90 },
      { label: "For", width: 300, wrap: true },
      { label: "Paid / received by", width: 140 },
      { label: "Amount", width: 80, align: "r" },
    ],
    rows,
  };
}

export function voucherListCsv(l: List) {
  return [
    ["Date", "Number", "Type", "For", "Party", "Paid / received by", "Narration", "Amount", "GST", "TDS", "Cancelled"],
    ...l.rows.map((v) => [
      v.date,
      v.number,
      VOUCHER_TYPE_LABEL[v.type],
      v.what,
      v.party ?? "",
      v.via,
      v.narration ?? "",
      rupees(v.amount),
      v.gst ? rupees(v.gst) : "",
      v.tds ? rupees(v.tds) : "",
      v.cancelled ? "yes" : "",
    ]),
  ];
}

/** One voucher, to print and sign. */
export function voucherSheet(v: Detail, from: { name: string }): Sheet {
  const rows: SheetRow[] = [];
  if (v.party) rows.push({ kind: "note", text: `${v.type === "RECEIPT" ? "Received from" : "Paid to"}: ${v.party}${v.partyGstin ? ` · GSTIN ${v.partyGstin}` : ""}` });
  const how = [v.method ? VOUCHER_METHOD_LABEL[v.method] : null, v.staffName, v.cheque ? `cheque ${v.cheque.number} dated ${showDay(v.cheque.date.toISOString().slice(0, 10))}` : null, v.reference]
    .filter(Boolean)
    .join(" · ");
  if (how) rows.push({ kind: "note", text: how });
  for (const l of v.lines)
    rows.push({ kind: "row", cells: [String(l.sl), `${l.name}${l.note ? ` (${l.note})` : ""}`, l.amount > 0 ? formatINR(l.amount) : "", l.amount < 0 ? formatINR(-l.amount) : ""] });
  const debit = v.lines.reduce((a, l) => a + Math.max(0, l.amount), 0);
  rows.push({ kind: "total", cells: ["", "Total", formatINR(debit), formatINR(debit)] });
  if (v.narration) rows.push({ kind: "note", text: v.narration });
  if (v.cancelledAt) rows.push({ kind: "note", text: `CANCELLED: ${v.cancelReason ?? ""}` });
  rows.push({ kind: "note", text: `For ${from.name}` });
  rows.push({
    kind: "note",
    text:
      v.type === "JOURNAL" || v.type === "CONTRA"
        ? "Entered by ____________________     Checked by ____________________"
        : `${v.type === "RECEIPT" ? "Paid by" : "Received by"} ____________________     Approved by ____________________`,
  });
  return {
    title: `${VOUCHER_TYPE_LABEL[v.type]} ${v.number}`,
    subtitle: `Dated ${showDay(v.date)} · ${formatINR(v.amount)}${v.createdBy ? ` · entered by ${v.createdBy}` : ""}`,
    landscape: false,
    cols: [
      { label: "#", width: 25, align: "r" },
      { label: "Account", width: 285, wrap: true },
      { label: "Debit", width: 85, align: "r" },
      { label: "Credit", width: 85, align: "r" },
    ],
    rows,
  };
}

export function voucherCsv(v: Detail) {
  return [["#", "Account", "Note", "Debit", "Credit"], ...v.lines.map((l) => [l.sl, l.name, l.note ?? "", l.amount > 0 ? rupees(l.amount) : "", l.amount < 0 ? rupees(-l.amount) : ""])];
}

const bookName = (b: Book) => (b.kind === "bank" ? "Bank book" : "Cash book");

export function cashBookSheet(b: Book): Sheet {
  const bank = b.kind === "bank";
  const rows: SheetRow[] = [{ kind: "sub", cells: [showDay(b.from), "Opening balance", "", "", "", drcr(b.opening)] }];
  for (const d of b.days) {
    for (const r of d.rows) {
      rows.push({ kind: "row", cells: [showDay(r.date), `${r.kindLabel}${r.memo ? `: ${r.memo}` : ""}`, `${r.against}${bank ? (r.inBank ? " · seen" : "") : ""}`, amt(r.debit), amt(r.credit), ""] });
    }
    rows.push({ kind: "sub", cells: ["", `Day total ${showDay(d.date)}`, "", amt(d.moneyIn), amt(d.moneyOut), drcr(d.closing)] });
  }
  rows.push({ kind: "total", cells: ["", "Totals for the period", "", amt(b.debit), amt(b.credit), ""] });
  rows.push({ kind: "sub", cells: [showDay(b.to), "Closing balance", "", "", "", drcr(b.closing)] });
  if (b.recon) {
    const r = b.recon;
    rows.push({ kind: "note", text: `"seen" = matched to a bank statement line. Not yet seen: in ${formatINR(r.notSeenIn)}, out ${formatINR(r.notSeenOut)}.` });
    if (r.statementBalance !== null)
      rows.push({
        kind: "note",
        text: `Last statement balance ${formatINR(r.statementBalance)} on ${showDay(r.statementDate!)}; ${r.unmatchedLines} statement lines not matched yet (in ${formatINR(r.unmatchedIn)}, out ${formatINR(r.unmatchedOut)}).`,
      });
  }
  if (b.capped) rows.push({ kind: "note", text: "Only the first 3,000 entries are shown. Pick a shorter period for the rest." });
  return {
    title: `${bookName(b)}: ${b.name}`,
    subtitle: period(b.from, b.to),
    landscape: true,
    cols: [
      { label: "Date", width: 50 },
      { label: "Particulars", width: 230, wrap: true },
      { label: "Against", width: 150 },
      { label: "In", width: 70, align: "r" },
      { label: "Out", width: 70, align: "r" },
      { label: "Balance", width: 80, align: "r" },
    ],
    rows,
  };
}

export function cashBookCsv(b: Book) {
  const bank = b.kind === "bank";
  return [
    ["Date", "Type", "Particulars", "Against", "In", "Out", "Balance", ...(bank ? ["In bank statement"] : [])],
    [b.from, "", "Opening balance", "", "", "", csvDrcr(b.opening)],
    ...b.days.flatMap((d) =>
      d.rows.map((r) => [
        r.date,
        r.kindLabel,
        r.memo ?? "",
        r.against,
        r.debit ? rupees(r.debit) : "",
        r.credit ? rupees(r.credit) : "",
        csvDrcr(r.balance),
        ...(bank ? [r.inBank ? "yes" : "no"] : []),
      ]),
    ),
    ["", "", "Totals for the period", "", rupees(b.debit), rupees(b.credit), ""],
    [b.to, "", "Closing balance", "", "", "", csvDrcr(b.closing)],
  ];
}
