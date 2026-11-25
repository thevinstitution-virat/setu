import { formatINR } from "@/lib/money";
import type { Sheet, SheetRow } from "@/lib/dues-export";
import { showDay } from "@/lib/books";
import { headsTotal, usedTotal, type Heads } from "@/lib/gst-math";
import { INWARD_LABEL, type gstMonth, type itcRegister, type match2b } from "@/lib/gst-returns";

/** GSTR-3B working, input credit register and 2B match as PDF sheets and CSV rows. */

type Month = Awaited<ReturnType<typeof gstMonth>>;
type Register = Awaited<ReturnType<typeof itcRegister>>;
type Match = Awaited<ReturnType<typeof match2b>>;
type Cell = string | number | null;

const rupees = (p: number) => (p / 100).toFixed(2);
const amt = (p: number) => (p ? (p < 0 ? `(${formatINR(-p)})` : formatINR(p)) : "–");

export type WorkingLine = { kind: "group"; label: string } | { kind: "row" | "sub" | "total"; label: string; taxable: number | null; h: Heads };

/** The 3B lines in the portal's order, and table 6.1 as rows by head. */
export function workingLines(m: Month, all = false): WorkingLine[] {
  const w = m.working;
  const s = m.setOff;
  const z: Heads = { igst: 0, cgst: 0, sgst: 0 };
  const L: WorkingLine[] = [
    { kind: "group", label: "3.1 Outward supplies and inward supplies liable to reverse charge" },
    { kind: "row", label: "(a) Outward taxable supplies (less credit notes)", taxable: w.outward.taxable, h: w.outward },
    { kind: "row", label: "(b) Zero rated", taxable: 0, h: z },
    { kind: "row", label: "(c) Nil rated and exempted", taxable: w.nil, h: z },
    { kind: "row", label: "(d) Inward supplies liable to reverse charge", taxable: w.rcmInward.taxable, h: w.rcmInward },
    { kind: "row", label: "(e) Non-GST outward supplies", taxable: 0, h: z },
    { kind: "group", label: "3.2 Inter-state supplies to unregistered persons" },
    ...(w.interB2c.length
      ? w.interB2c.map((p) => ({ kind: "row" as const, label: p.label, taxable: p.taxable, h: { igst: p.igst, cgst: 0, sgst: 0 } }))
      : [{ kind: "row" as const, label: "None", taxable: null, h: z }]),
    { kind: "group", label: "4 Eligible input credit" },
    { kind: "row", label: "(A)(3) Inward supplies liable to reverse charge", taxable: null, h: w.itc.rcm },
    { kind: "row", label: "(A)(5) All other input credit", taxable: null, h: w.itc.other },
    { kind: "row", label: "    from bills", taxable: null, h: w.itc.bills },
    { kind: "row", label: "    less suppliers' credit notes and our debit notes", taxable: null, h: w.itc.notes },
    { kind: "row", label: "    from expense vouchers", taxable: null, h: w.itc.vouchers },
    { kind: "sub", label: "(C) Net input credit", taxable: null, h: w.itc.net },
    { kind: "row", label: "(D) Ineligible (not claimed)", taxable: null, h: w.itc.ineligible },
    { kind: "group", label: "5 Exempt, nil-rated and non-GST inward supplies" },
    { kind: "row", label: "Inter-state", taxable: w.exemptIn.inter, h: z },
    { kind: "row", label: "Intra-state", taxable: w.exemptIn.intra, h: z },
    { kind: "group", label: "6.1 Payment of tax" },
    { kind: "row", label: "Tax payable (other than reverse charge)", taxable: null, h: s.liab },
    { kind: "row", label: "Reverse charge payable", taxable: null, h: s.rcm },
    { kind: "row", label: "Credit brought forward", taxable: null, h: m.opening },
    { kind: "row", label: "Credit of the month", taxable: null, h: w.itc.net },
    { kind: "row", label: "Paid from IGST credit", taxable: null, h: { igst: s.use.igstIgst, cgst: s.use.igstCgst, sgst: s.use.igstSgst } },
    { kind: "row", label: "Paid from CGST credit", taxable: null, h: { igst: s.use.cgstIgst, cgst: s.use.cgstCgst, sgst: 0 } },
    { kind: "row", label: "Paid from SGST credit", taxable: null, h: { igst: s.use.sgstIgst, cgst: 0, sgst: s.use.sgstSgst } },
    ...(all || headsTotal(s.reversal) ? [{ kind: "row" as const, label: "Credit taken back, paid in cash", taxable: null, h: s.reversal }] : []),
    { kind: "total", label: "Paid in cash", taxable: null, h: s.cash },
    { kind: "sub", label: "Credit carried forward", taxable: null, h: s.close },
  ];
  return L;
}

const status = (m: Month) =>
  m.settled
    ? `Settled: paid ${showDay(m.settled.paidOn)}${m.settled.bank ? ` from ${m.settled.bank}` : ""}${m.settled.challan ? `, challan ${m.settled.challan}` : ""}${m.settled.arn ? `, ARN ${m.settled.arn}` : ""}`
    : "Not settled yet: figures as they stand";

export function monthSheet(m: Month): Sheet {
  const rows: SheetRow[] = [];
  for (const l of workingLines(m)) {
    if (l.kind === "group") rows.push({ kind: "group", text: l.label });
    else rows.push({ kind: l.kind, cells: [l.label, l.taxable === null ? "" : amt(l.taxable), amt(l.h.igst), amt(l.h.cgst), amt(l.h.sgst), amt(headsTotal(l.h))] });
  }
  for (const w of m.working.warnings) rows.push({ kind: "note", text: w });
  if (m.settled?.changed) rows.push({ kind: "note", text: "Documents of this month changed after it was settled: the settlement shows the figures as they were." });
  return {
    title: `GSTR-3B working: ${m.working.label}`,
    subtitle: `${m.working.gstin ? `GSTIN ${m.working.gstin} · ` : ""}${status(m)}`,
    landscape: true,
    cols: [
      { label: "", width: 300, wrap: true },
      { label: "Taxable value", width: 100, align: "r" },
      { label: "IGST", width: 90, align: "r" },
      { label: "CGST", width: 90, align: "r" },
      { label: "SGST", width: 90, align: "r" },
      { label: "Tax", width: 90, align: "r" },
    ],
    rows,
  };
}

export function monthCsv(m: Month): Cell[][] {
  const out: Cell[][] = [["Table", "Line", "Taxable value", "IGST", "CGST", "SGST"]];
  let group = "";
  for (const l of workingLines(m)) {
    if (l.kind === "group") group = l.label;
    else out.push([group, l.label.trim(), l.taxable === null ? "" : rupees(l.taxable), rupees(l.h.igst), rupees(l.h.cgst), rupees(l.h.sgst)]);
  }
  out.push(["", status(m)]);
  return out;
}

/** Several months side by side (the CA pack): one row per line, taxable / IGST / CGST / SGST per month; 3.2 listed after. */
export function monthsCsv(months: Month[]): Cell[][] {
  if (!months.length) return [["No months in this period"]];
  const tagged = months.map((m) => {
    let group = "";
    const out: { group: string; line: Exclude<WorkingLine, { kind: "group" }> }[] = [];
    for (const l of workingLines(m, true)) {
      if (l.kind === "group") group = l.label;
      else if (!group.startsWith("3.2")) out.push({ group, line: l });
    }
    return out;
  });
  const head: Cell[] = ["Line"];
  for (const m of months) head.push(`${m.working.label} taxable`, `${m.working.label} IGST`, `${m.working.label} CGST`, `${m.working.label} SGST`);
  const out: Cell[][] = [head];
  tagged[0].forEach((x, i) => {
    const r: Cell[] = [`${x.group.split(" ")[0]} ${x.line.label.trim()}`];
    for (const t of tagged) {
      const v = t[i].line;
      r.push(v.taxable === null ? "" : rupees(v.taxable), rupees(v.h.igst), rupees(v.h.cgst), rupees(v.h.sgst));
    }
    out.push(r);
  });
  out.push([]);
  out.push(["3.2 Inter-state supplies to unregistered persons", "Month", "Place of supply", "Taxable value", "IGST"]);
  for (const m of months) for (const p of m.working.interB2c) out.push(["", m.working.label, p.label, rupees(p.taxable), rupees(p.igst)]);
  out.push([]);
  out.push(["Settled", ...months.flatMap((m) => [m.settled ? `${showDay(m.settled.paidOn)} ${m.settled.challan ?? ""}`.trim() : "Not settled", "", "", ""])]);
  return out;
}

// ───────────────────────────── input credit register ─────────────────────────────

export function itcSheet(r: Register): Sheet {
  const rows: SheetRow[] = [{ kind: "group", text: "By month" }];
  for (const m of r.byMonth) rows.push({ kind: "row", cells: [m.label, `${m.docs}`, amt(m.taxable), amt(m.igst), amt(m.cgst), amt(m.sgst), amt(m.ineligible)] });
  rows.push({ kind: "total", cells: ["Total", "", amt(r.totals.taxable), amt(r.totals.igst), amt(r.totals.cgst), amt(r.totals.sgst), amt(r.totals.ineligible)] });
  rows.push({ kind: "group", text: "By GST rate" });
  for (const x of r.byRate) rows.push({ kind: "row", cells: [x.rate === null ? "Expense vouchers (not split by rate)" : `${x.rate}%`, "", amt(x.taxable), amt(x.igst), amt(x.cgst), amt(x.sgst), ""] });
  rows.push({ kind: "group", text: "Documents" });
  for (const d of r.docs)
    rows.push({
      kind: "row",
      cells: [
        `${showDay(d.date)} ${INWARD_LABEL[d.src]} ${d.ref || d.number}${d.rcm ? " (reverse charge)" : ""} · ${d.party}${d.gstin ? ` ${d.gstin}` : ""}`,
        d.rates,
        amt(d.taxable),
        amt(d.igst),
        amt(d.cgst),
        amt(d.sgst),
        amt(d.ineligible),
      ],
    });
  if (r.capped) rows.push({ kind: "note", text: "Only the first 5,000 documents are listed; the totals are for all." });
  return {
    title: "Input credit register",
    subtitle: `${showDay(r.from)} to ${showDay(r.to)} · notes take credit back (shown in brackets)`,
    landscape: true,
    cols: [
      { label: "", width: 330, wrap: true },
      { label: "Rates / docs", width: 70 },
      { label: "Taxable", width: 90, align: "r" },
      { label: "IGST", width: 80, align: "r" },
      { label: "CGST", width: 80, align: "r" },
      { label: "SGST", width: 80, align: "r" },
      { label: "Ineligible", width: 80, align: "r" },
    ],
    rows,
  };
}

export function itcCsv(r: Register): Cell[][] {
  return [
    ["Date", "Document", "Our number", "Their number", "Supplier", "GSTIN", "Reverse charge", "Rates", "Taxable", "IGST", "CGST", "SGST", "Ineligible tax"],
    ...r.docs.map((d) => [
      d.date,
      INWARD_LABEL[d.src],
      d.number,
      d.ref,
      d.party,
      d.gstin ?? "",
      d.rcm ? "Yes" : "No",
      d.rates,
      rupees(d.taxable),
      rupees(d.igst),
      rupees(d.cgst),
      rupees(d.sgst),
      rupees(d.ineligible),
    ]),
    ["", "Total", "", "", "", "", "", "", rupees(r.totals.taxable), rupees(r.totals.igst), rupees(r.totals.cgst), rupees(r.totals.sgst), rupees(r.totals.ineligible)],
  ];
}

// ───────────────────────────── 2B match ─────────────────────────────

export function matchCsv(m: Match): Cell[][] {
  const out: Cell[][] = [
    [
      "Status",
      "Supplier GSTIN",
      "Supplier",
      "Their number",
      "Date (ours)",
      "Date (2B)",
      "Our number",
      "Taxable (ours)",
      "Taxable (2B)",
      "Tax (ours)",
      "Tax (2B)",
      "Input credit (ours)",
      "2B month",
      "Credit available in 2B",
    ],
  ];
  const add = (st: string, x: { ours: Match["matched"][number]["ours"]; theirs: Match["matched"][number]["theirs"] }) =>
    out.push([
      st,
      x.ours?.gstin || x.theirs?.gstin || "",
      x.ours?.party ?? x.theirs?.name ?? "",
      x.ours?.ref ?? x.theirs?.number ?? "",
      x.ours?.date ?? "",
      x.theirs?.date ?? "",
      x.ours?.number ?? "",
      x.ours ? rupees(x.ours.taxable) : "",
      x.theirs ? rupees(x.theirs.taxable) : "",
      x.ours ? rupees(x.ours.tax) : "",
      x.theirs ? rupees(x.theirs.tax) : "",
      x.ours ? rupees(x.ours.itc) : "",
      x.theirs?.period ?? "",
      x.theirs ? (x.theirs.itcAvailable ? "Yes" : "No") : "",
    ]);
  for (const x of m.different) add("Amounts differ", x);
  for (const x of m.missing) add(x.earlier ? "Not in 2B (earlier month)" : "Not in 2B", x);
  for (const x of m.notInBooks) add("In 2B, not in our books", x);
  for (const x of m.matched) add("Matched", x);
  return out;
}

export const settledLine = (m: Month) =>
  `GSTR-3B ${m.working.label}: tax ${formatINR(headsTotal(m.setOff.liab) + headsTotal(m.setOff.rcm))}, from credit ${formatINR(usedTotal(m.setOff.use))}, in cash ${formatINR(headsTotal(m.setOff.cash))}.`;
