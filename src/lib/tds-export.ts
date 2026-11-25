import { formatINR } from "@/lib/money";
import type { Sheet, SheetRow } from "@/lib/dues-export";
import { showDay } from "@/lib/books";
import { rateLabel } from "@/lib/tds-math";
import { TDS_SOURCE_LABEL, type return26q, type tdsReceived, type tdsRegister, type tdsYear } from "@/lib/tds";

/** TDS register, year (paid vs due), 26Q working and TDS kept back by customers, as PDF sheets and CSV rows. */

type Register = Awaited<ReturnType<typeof tdsRegister>>;
type Year = Awaited<ReturnType<typeof tdsYear>>;
type Q = Awaited<ReturnType<typeof return26q>>;
type Received = Awaited<ReturnType<typeof tdsReceived>>;
type Cell = string | number | null;

const rupees = (p: number) => (p / 100).toFixed(2);
const amt = (p: number) => (p ? formatINR(p) : "–");
export const STATUS_LABEL: Record<Year["groups"][number]["status"], string> = { PAID: "Paid", PAID_LATE: "Paid late", DUE: "Due", LATE: "Late, not paid", OVER: "Paid more than kept back" };

export function registerSheet(r: Register): Sheet {
  const rows: SheetRow[] = [{ kind: "group", text: "By section" }];
  for (const s of r.bySection) rows.push({ kind: "row", cells: [s.section, `${s.docs}`, amt(s.base), amt(s.tds)] });
  rows.push({ kind: "total", cells: ["Total", `${r.rows.length}`, amt(r.totals.base), amt(r.totals.tds)] });
  rows.push({ kind: "group", text: "By quarter" });
  for (const q of r.byQuarter) rows.push({ kind: "row", cells: [q.label, `${q.docs}`, amt(q.base), amt(q.tds)] });
  rows.push({ kind: "group", text: "By party" });
  for (const p of r.byParty) rows.push({ kind: "row", cells: [`${p.party} · ${p.pan ?? "no PAN"}`, `${p.docs}`, amt(p.base), amt(p.tds)] });
  rows.push({ kind: "group", text: "Deductions" });
  for (const d of r.rows) rows.push({ kind: "row", cells: [`${showDay(d.date)} ${d.number} · ${TDS_SOURCE_LABEL[d.source]} · ${d.party}${d.pan ? ` ${d.pan}` : ""} · ${d.section} at ${rateLabel(d.rate)}`, "", amt(d.base), amt(d.tds)] });
  if (r.totals.noPan) rows.push({ kind: "note", text: `${r.totals.noPan} deductions have no PAN for the party.` });
  return {
    title: "TDS register",
    subtitle: `${showDay(r.from)} to ${showDay(r.to)} · TDS we kept back`,
    landscape: false,
    cols: [
      { label: "", width: 300, wrap: true },
      { label: "Docs", width: 40, align: "r" },
      { label: "Paid / credited", width: 90, align: "r" },
      { label: "TDS", width: 80, align: "r" },
    ],
    rows,
  };
}

export function registerCsv(r: Register): Cell[][] {
  return [
    ["Date", "Number", "From", "Party", "PAN", "Section", "Rate %", "Paid / credited", "TDS"],
    ...r.rows.map((d) => [d.date, d.number, TDS_SOURCE_LABEL[d.source], d.party, d.pan ?? "", d.section, (d.rate / 100).toFixed(2), rupees(d.base), rupees(d.tds)]),
    ["", "", "", "Total", "", "", "", rupees(r.totals.base), rupees(r.totals.tds)],
  ];
}

export function yearSheet(y: Year): Sheet {
  const rows: SheetRow[] = [];
  for (const g of y.groups) rows.push({ kind: "row", cells: [`${g.label} · ${g.section}`, showDay(g.due), amt(g.deducted), amt(g.paid), amt(g.unpaid), amt(g.interestDue), STATUS_LABEL[g.status]] });
  rows.push({ kind: "total", cells: ["Total", "", amt(y.totals.deducted), amt(y.totals.paid), amt(y.totals.unpaid), amt(y.totals.interestDue), ""] });
  rows.push({ kind: "group", text: "Challans" });
  for (const c of y.challans)
    rows.push({ kind: "row", cells: [`${showDay(c.paidOn)} ${c.number} · ${c.section} for ${c.periodLabel} · BSR ${c.bsrCode} / ${c.serial}${c.cancelledAt ? " (cancelled)" : ""}`, "", amt(c.tax), amt(c.interest + c.lateFee), "", "", c.bank ?? ""] });
  rows.push({ kind: "note", text: "Due by the 7th of the next month (March: 30 April). Interest at 1.5% a month or part of a month from the deduction until paid; worked out by the app, check with the challan." });
  return {
    title: `TDS paid and due, FY ${y.label}`,
    subtitle: "TDS kept back each month and section against the challans paid",
    landscape: true,
    cols: [
      { label: "", width: 280, wrap: true },
      { label: "Due by", width: 70 },
      { label: "Kept back", width: 85, align: "r" },
      { label: "Paid", width: 85, align: "r" },
      { label: "Not paid", width: 85, align: "r" },
      { label: "Interest", width: 70, align: "r" },
      { label: "", width: 100, wrap: true },
    ],
    rows,
  };
}

export function yearCsv(y: Year): Cell[][] {
  return [
    ["Month", "Section", "Due by", "Kept back", "Paid", "Not paid", "Interest (worked out)", "Interest paid", "Status"],
    ...y.groups.map((g) => [g.period, g.section, g.due, rupees(g.deducted), rupees(g.paid), rupees(g.unpaid), rupees(g.interest), rupees(g.interestPaid), STATUS_LABEL[g.status]]),
    [],
    ["Challan", "Section", "Month", "Paid on", "BSR code", "Serial", "Tax", "Interest", "Late fee", "Bank", "Cancelled"],
    ...y.challans.map((c) => [c.number, c.section, c.period, c.paidOn, c.bsrCode, c.serial, rupees(c.tax), rupees(c.interest), rupees(c.lateFee), c.bank ?? "", c.cancelledAt ? "Yes" : ""]),
  ];
}

export function q26Sheet(q: Q): Sheet {
  const rows: SheetRow[] = [{ kind: "group", text: "Challans" }];
  for (const c of q.challans) rows.push({ kind: "row", cells: [`${c.number} · ${c.section} · BSR ${c.bsrCode} · ${showDay(c.paidOn)} · serial ${c.serial}`, "", amt(c.tax), amt(c.used)] });
  rows.push({ kind: "group", text: "Deductee details" });
  for (const r of q.rows)
    rows.push({
      kind: "row",
      cells: [`${showDay(r.date)} ${r.party} · ${r.pan ?? "NO PAN"} · ${r.section} at ${rateLabel(r.rate)} · ${r.challan ? `challan ${r.challan.bsrCode}/${r.challan.serial} ${showDay(r.challan.paidOn)}` : "NOT PAID"}`, "", amt(r.base), amt(r.tds)],
    });
  rows.push({ kind: "total", cells: ["Total", "", amt(q.totals.base), amt(q.totals.tds)] });
  for (const w of q.warnings) rows.push({ kind: "note", text: w });
  rows.push({ kind: "note", text: `A working for the return (26Q): type it into the return preparation utility. Due ${showDay(q.due)}.` });
  return {
    title: `TDS return working (26Q), ${q.label}`,
    subtitle: `${showDay(q.from)} to ${showDay(q.to)}`,
    landscape: false,
    cols: [
      { label: "", width: 330, wrap: true },
      { label: "", width: 10 },
      { label: "Paid / credited · tax", width: 90, align: "r" },
      { label: "TDS · used", width: 80, align: "r" },
    ],
    rows,
  };
}

export function q26Csv(q: Q): Cell[][] {
  return [
    ["Challan BSR code", "Challan date", "Challan serial", "Section", "Deductee PAN", "Deductee name", "Date paid / credited", "Amount paid / credited", "TDS", "Rate %", "Date deducted", "Our document"],
    ...q.rows.map((r) => [r.challan?.bsrCode ?? "", r.challan?.paidOn ?? "", r.challan?.serial ?? "", r.section, r.pan ?? "", r.party, r.date, rupees(r.base), rupees(r.tds), (r.rate / 100).toFixed(2), r.date, r.number]),
  ];
}

export function receivedSheet(r: Received): Sheet {
  const rows: SheetRow[] = [{ kind: "group", text: "By customer" }];
  for (const p of r.byParty) rows.push({ kind: "row", cells: [`${p.party} · ${p.pan ?? "no PAN"}${p.pending ? ` · ${p.pending} certificate${p.pending === 1 ? "" : "s"} to get` : ""}`, `${p.docs}`, amt(p.tds)] });
  rows.push({ kind: "total", cells: ["Total", `${r.rows.length}`, amt(r.totals.tds)] });
  rows.push({ kind: "group", text: "Entries" });
  for (const x of r.rows) rows.push({ kind: "row", cells: [`${showDay(x.date)} ${x.number} · ${x.party} · ${x.section} · ${x.certificate ? `certificate ${x.certificate}` : "no certificate yet"}`, "", amt(x.tds)] });
  return {
    title: "TDS kept back by customers",
    subtitle: `${showDay(r.from)} to ${showDay(r.to)} · claimed in our income tax return; check against Form 26AS`,
    landscape: false,
    cols: [
      { label: "", width: 380, wrap: true },
      { label: "Entries", width: 50, align: "r" },
      { label: "TDS", width: 90, align: "r" },
    ],
    rows,
  };
}

export function receivedCsv(r: Received): Cell[][] {
  return [["Date", "Number", "Customer", "PAN", "Section", "TDS", "Certificate"], ...r.rows.map((x) => [x.date, x.number, x.party, x.pan ?? "", x.section, rupees(x.tds), x.certificate ?? ""])];
}
