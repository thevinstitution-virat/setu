import { formatINR } from "@/lib/money";
import { showDay } from "@/lib/books";
import type { Sheet, SheetRow } from "@/lib/dues-export";
import { CLAIM_AGE_LABEL, CLAIM_TYPE_LABEL, SETTLE_KIND_LABEL } from "@/lib/claim-labels";
import { periodText, type claimDetail, type claimsByType, type pendingClaims, type settlementsIn } from "@/lib/claims";

/** Claims reports and the claim letter as PDF sheets, CSV rows and a WhatsApp summary. */

type Pending = Awaited<ReturnType<typeof pendingClaims>>;
type Settled = Awaited<ReturnType<typeof settlementsIn>>;
type ByType = Awaited<ReturnType<typeof claimsByType>>;
type Detail = Awaited<ReturnType<typeof claimDetail>>;

const amt = (p: number) => (p ? formatINR(p) : "");
const rupees = (p: number) => (p / 100).toFixed(2);
const span = (from: string, to: string) => (from === to ? `On ${showDay(from)}` : `${showDay(from)} to ${showDay(to)}`);
const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString("en-IN")} ${k === 1 ? one : many}`;
const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// ── pending, by company and age ──
export function pendingSheet(r: Pending, filters = ""): Sheet {
  const rows: SheetRow[] = [];
  for (const co of r.companies) {
    rows.push({ kind: "group", text: co.company, right: formatINR(co.open) });
    for (const c of r.claims.filter((x) => x.supplierId === co.supplierId))
      rows.push({
        kind: "row",
        cells: [c.number, showDay(c.date), CLAIM_TYPE_LABEL[c.type], [periodText(c), c.reference].filter(Boolean).join(" · "), formatINR(c.amount), amt(c.done), formatINR(c.open), String(c.age)],
      });
  }
  rows.push({ kind: "total", cells: [n(r.totals.claims, "claim"), "", "", "", "", "", formatINR(r.totals.open), ""] });
  rows.push({
    kind: "note",
    text: `By age from the day raised: ${(Object.keys(CLAIM_AGE_LABEL) as (keyof typeof CLAIM_AGE_LABEL)[]).map((k) => `${CLAIM_AGE_LABEL[k]} ${formatINR(r.totals[k])}`).join(" · ")}.`,
  });
  return {
    title: "Claims pending with companies",
    subtitle: [`As on ${showDay(r.asOn)}`, filters].filter(Boolean).join(" · "),
    landscape: true,
    cols: [
      { label: "Claim", width: 80 },
      { label: "Raised", width: 55 },
      { label: "For", width: 80 },
      { label: "Period / reference", width: 170, wrap: true },
      { label: "Claimed", width: 75, align: "r" },
      { label: "Received", width: 75, align: "r" },
      { label: "Open", width: 75, align: "r" },
      { label: "Days", width: 35, align: "r" },
    ],
    rows,
  };
}
export const pendingCsv = (r: Pending) => [
  ["Claim", "Raised", "Company", "Type", "Period from", "Period to", "Reference", "Claimed", "Received / written off", "Open", "Days since raised", "Age"],
  ...r.claims.map((c) => [
    c.number,
    c.date,
    c.company,
    CLAIM_TYPE_LABEL[c.type],
    c.periodFrom ?? "",
    c.periodTo ?? "",
    c.reference ?? "",
    rupees(c.amount),
    rupees(c.done),
    rupees(c.open),
    c.age,
    CLAIM_AGE_LABEL[c.bucket],
  ]),
  ["Total", "", "", "", "", "", "", "", "", rupees(r.totals.open), "", ""],
];

// ── settled in a period ──
export function settledSheet(r: Settled, filters = ""): Sheet {
  const rows: SheetRow[] = r.rows.map((x) => ({ kind: "row", cells: [showDay(x.date), x.claim, x.company, CLAIM_TYPE_LABEL[x.type], SETTLE_KIND_LABEL[x.kind], x.how, formatINR(x.amount)] }));
  rows.push({ kind: "total", cells: [n(r.rows.length, "entry", "entries"), "", "", "", "", "", formatINR(r.totals.creditNotes + r.totals.received + r.totals.writtenOff)] });
  rows.push({ kind: "note", text: `Credit notes ${formatINR(r.totals.creditNotes)} · money received ${formatINR(r.totals.received)} · written off ${formatINR(r.totals.writtenOff)}.` });
  return {
    title: "Claims settled",
    subtitle: [span(r.from, r.to), filters].filter(Boolean).join(" · "),
    landscape: true,
    cols: [
      { label: "Date", width: 55 },
      { label: "Claim", width: 80 },
      { label: "Company", width: 130, wrap: true },
      { label: "For", width: 75 },
      { label: "How", width: 85 },
      { label: "Details", width: 140, wrap: true },
      { label: "Amount", width: 75, align: "r" },
    ],
    rows,
  };
}
export const settledCsv = (r: Settled) => [
  ["Date", "Claim", "Company", "Type", "How", "Details", "Amount"],
  ...r.rows.map((x) => [x.date, x.claim, x.company, CLAIM_TYPE_LABEL[x.type], SETTLE_KIND_LABEL[x.kind], x.how, rupees(x.amount)]),
];

// ── claimed vs received, by type ──
export function byTypeSheet(r: ByType, filters = ""): Sheet {
  const rows: SheetRow[] = r.types.map((t) => ({
    kind: "row",
    cells: [CLAIM_TYPE_LABEL[t.type], String(t.claims), amt(t.claimed), amt(t.received), amt(t.writtenOff), amt(t.open), t.claimed ? `${t.pct}%` : ""],
  }));
  rows.push({
    kind: "total",
    cells: [
      "Total",
      String(r.totals.claims),
      formatINR(r.totals.claimed),
      formatINR(r.totals.received),
      formatINR(r.totals.writtenOff),
      formatINR(r.totals.open),
      r.totals.claimed ? `${r.totals.pct}%` : "",
    ],
  });
  rows.push({ kind: "note", text: "Claims raised in the period; received counts credit notes and money in up to today." });
  return {
    title: "Claims: claimed vs received",
    subtitle: [span(r.from, r.to), filters].filter(Boolean).join(" · "),
    landscape: false,
    cols: [
      { label: "For", width: 110 },
      { label: "Claims", width: 45, align: "r" },
      { label: "Claimed", width: 75, align: "r" },
      { label: "Received", width: 75, align: "r" },
      { label: "Written off", width: 70, align: "r" },
      { label: "Open", width: 70, align: "r" },
      { label: "Got", width: 40, align: "r" },
    ],
    rows,
  };
}
export const byTypeCsv = (r: ByType) => [
  ["Type", "Claims", "Claimed", "Received", "Written off", "Open", "Received %"],
  ...r.types.map((t) => [CLAIM_TYPE_LABEL[t.type], t.claims, rupees(t.claimed), rupees(t.received), rupees(t.writtenOff), rupees(t.open), t.pct]),
  ["Total", r.totals.claims, rupees(r.totals.claimed), rupees(r.totals.received), rupees(r.totals.writtenOff), rupees(r.totals.open), r.totals.pct],
];

// ── the claim letter ──
export function letterSheet(c: Detail, from: { name: string }): Sheet {
  const period = periodText({ type: c.type, periodFrom: ymd(c.periodFrom), periodTo: ymd(c.periodTo) });
  const rows: SheetRow[] = [
    { kind: "note", text: `To: ${c.supplier.name}${c.supplier.contactName ? ` (attn. ${c.supplier.contactName})` : ""}${c.supplier.gstin ? ` · GSTIN ${c.supplier.gstin}` : ""}` },
    ...(c.supplier.address ? [{ kind: "note" as const, text: c.supplier.address }] : []),
    { kind: "note", text: `Subject: ${CLAIM_TYPE_LABEL[c.type]} claim ${c.number}${period ? ` · ${period}` : ""}${c.reference ? ` · ${c.reference}` : ""}` },
    { kind: "note", text: `Please settle the claim below, totalling ${formatINR(c.amount)}, by a credit note or payment quoting ${c.number}.` },
    ...c.lines.map((l) => ({
      kind: "row" as const,
      cells: [String(l.sl), l.description + (l.evidence ? ` (${l.evidence})` : ""), l.quantity.toLocaleString("en-IN"), formatINR(l.rate), formatINR(l.amount)],
    })),
    { kind: "total", cells: ["", "Total claimed", "", "", formatINR(c.amount)] },
  ];
  if (c.settled || c.writtenOff) rows.push({ kind: "note", text: `Received so far ${formatINR(c.settled)}; still to come ${formatINR(c.open)}.` });
  if (c.note) rows.push({ kind: "note", text: c.note });
  rows.push({ kind: "note", text: `For ${from.name}` });
  return {
    title: `Claim ${c.number}`,
    subtitle: `Dated ${showDay(ymd(c.date)!)} · ${CLAIM_TYPE_LABEL[c.type]}`,
    landscape: false,
    cols: [
      { label: "#", width: 25, align: "r" },
      { label: "What", width: 250, wrap: true },
      { label: "Qty", width: 50, align: "r" },
      { label: "Rate", width: 70, align: "r" },
      { label: "Amount", width: 80, align: "r" },
    ],
    rows,
  };
}
export const letterCsv = (c: Detail) => [
  ["#", "What", "Evidence", "Quantity", "Rate", "Amount"],
  ...c.lines.map((l) => [l.sl, l.description, l.evidence ?? "", l.quantity, rupees(l.rate), rupees(l.amount)]),
  ["", "Total", "", "", "", rupees(c.amount)],
];

/** One WhatsApp message for the report on screen. */
export function claimsSummary(report: "pending" | "settled" | "types", d: { pending?: Pending; settled?: Settled; types?: ByType }) {
  if (report === "settled" && d.settled)
    return `Claims settled, ${span(d.settled.from, d.settled.to).toLowerCase()}: credit notes ${formatINR(d.settled.totals.creditNotes)}, money received ${formatINR(d.settled.totals.received)}, written off ${formatINR(d.settled.totals.writtenOff)}.`;
  if (report === "types" && d.types)
    return `Claims raised ${span(d.types.from, d.types.to).toLowerCase()}: ${formatINR(d.types.totals.claimed)} claimed, ${formatINR(d.types.totals.received)} received (${d.types.totals.pct}%), ${formatINR(d.types.totals.open)} still open.`;
  if (d.pending) {
    const top = d.pending.companies
      .slice(0, 5)
      .map((c) => `${c.company} ${formatINR(c.open)}`)
      .join(", ");
    return `Claims pending as on ${showDay(d.pending.asOn)}: ${formatINR(d.pending.totals.open)} on ${n(d.pending.totals.claims, "claim")}${top ? ` (${top})` : ""}. Over 90 days: ${formatINR(d.pending.totals.older)}.`;
  }
  return "Claims report";
}
