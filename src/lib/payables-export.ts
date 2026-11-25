import { formatINR } from "@/lib/money";
import { showDay } from "@/lib/books";
import type { Sheet, SheetRow } from "@/lib/dues-export";
import { AGE_LABEL, PAY_METHOD_LABEL, type billsFallingDue, type openBillsOn, type payablesBySupplier, type paymentsList } from "@/lib/supplier-payments";

/** Payables reports (what we owe suppliers) as PDF sheets, CSV rows and a WhatsApp summary. */

type BySupplier = Awaited<ReturnType<typeof payablesBySupplier>>;
type Bills = Awaited<ReturnType<typeof openBillsOn>>;
type Due = Awaited<ReturnType<typeof billsFallingDue>>;
type Payments = Awaited<ReturnType<typeof paymentsList>>;

const amt = (p: number) => (p ? formatINR(p) : "");
const rupees = (p: number) => (p / 100).toFixed(2);
const period = (from: string, to: string) => (from === to ? `On ${showDay(from)}` : `${showDay(from)} to ${showDay(to)}`);
const n = (k: number, one: string, many = `${one}s`) => `${k.toLocaleString("en-IN")} ${k === 1 ? one : many}`;

// ── supplier-wise ──
export function bySupplierSheet(r: BySupplier, filters = ""): Sheet {
  const rows: SheetRow[] = r.rows.map((s) => ({
    kind: "row",
    cells: [
      `${s.name}${s.gstin ? ` · ${s.gstin}` : ""}`,
      String(s.bills),
      amt(s.notDue),
      amt(s.d30),
      amt(s.d60),
      amt(s.d90),
      amt(s.older),
      s.owed < 0 ? `${formatINR(-s.owed)} adv` : formatINR(s.owed),
    ],
  }));
  rows.push({
    kind: "total",
    cells: [n(r.rows.length, "supplier"), "", amt(r.totals.notDue), amt(r.totals.d30), amt(r.totals.d60), amt(r.totals.d90), amt(r.totals.older), formatINR(r.totals.owed)],
  });
  rows.push({
    kind: "note",
    text: "Owed is each supplier's account on the day; a minus (adv) is money paid ahead. The columns split their open bills by days past the due date.",
  });
  return {
    title: "Payables: supplier-wise",
    subtitle: [`As on ${showDay(r.asOn)}`, filters].filter(Boolean).join(" · "),
    landscape: true,
    cols: [
      { label: "Supplier", width: 200, wrap: true },
      { label: "Bills", width: 35, align: "r" },
      { label: AGE_LABEL.notDue, width: 70, align: "r" },
      { label: "1–30 late", width: 65, align: "r" },
      { label: "31–60", width: 65, align: "r" },
      { label: "61–90", width: 65, align: "r" },
      { label: "Over 90", width: 65, align: "r" },
      { label: "Owed", width: 85, align: "r" },
    ],
    rows,
  };
}
export const bySupplierCsv = (r: BySupplier) => [
  ["Supplier", "GSTIN", "Phone", "Open bills", "Not due", "1-30 days late", "31-60", "61-90", "Over 90", "Owed (minus = advance)"],
  ...r.rows.map((s) => [s.name, s.gstin ?? "", s.phone ?? "", s.bills, rupees(s.notDue), rupees(s.d30), rupees(s.d60), rupees(s.d90), rupees(s.older), rupees(s.owed)]),
  ["Total", "", "", "", rupees(r.totals.notDue), rupees(r.totals.d30), rupees(r.totals.d60), rupees(r.totals.d90), rupees(r.totals.older), rupees(r.totals.owed)],
];

// ── bill-wise with ageing ──
function billRows(bills: Bills): SheetRow[] {
  const rows: SheetRow[] = [];
  const by = new Map<string, Bills>();
  for (const b of bills) by.set(b.supplierId, [...(by.get(b.supplierId) ?? []), b]);
  for (const list of by.values()) {
    const left = list.reduce((a, b) => a + b.left, 0);
    rows.push({
      kind: "group",
      text: list[0].supplier,
      right: formatINR(left),
    });
    for (const b of list)
      rows.push({
        kind: "row",
        cells: [`${b.number}${b.kind === "OPENING" ? " (opening)" : ""}`, showDay(b.date), showDay(b.dueDate), amt(b.amount), formatINR(b.left), String(b.age), b.late ? String(b.late) : ""],
      });
  }
  return rows;
}
const billCols = [
  { label: "Their bill", width: 140, wrap: true },
  { label: "Bill date", width: 60 },
  { label: "Due", width: 60 },
  { label: "Amount", width: 85, align: "r" as const },
  { label: "Still to pay", width: 85, align: "r" as const },
  { label: "Age", width: 40, align: "r" as const },
  { label: "Days late", width: 50, align: "r" as const },
];
export function billsSheet(bills: Bills, asOn: string, filters = ""): Sheet {
  const rows = billRows(bills);
  rows.push({
    kind: "total",
    cells: [n(bills.length, "bill"), "", "", amt(bills.reduce((a, b) => a + b.amount, 0)), formatINR(bills.reduce((a, b) => a + b.left, 0)), "", ""],
  });
  return {
    title: "Payables: bill-wise",
    subtitle: [`As on ${showDay(asOn)}`, filters].filter(Boolean).join(" · "),
    landscape: false,
    cols: billCols,
    rows,
  };
}
export const billsCsv = (bills: Bills) => [
  ["Supplier", "Their bill no", "Kind", "Bill date", "Due date", "Bill amount", "Still to pay", "Age (days)", "Days late", "Ageing"],
  ...bills.map((b) => [b.supplier, b.number, b.kind === "OPENING" ? "Opening" : "Purchase", b.date, b.dueDate, rupees(b.amount), rupees(b.left), b.age, b.late, AGE_LABEL[b.bucket]]),
];

// ── falling due ──
export function dueSheet(d: Due, filters = ""): Sheet {
  const rows: SheetRow[] = [];
  if (d.overdue.length) {
    rows.push({
      kind: "group",
      text: "Late already",
      right: formatINR(d.totals.overdue),
    });
    rows.push(...billRows(d.overdue).map((r) => (r.kind === "group" ? { ...r, kind: "group2" as const } : r)));
  }
  if (d.soon.length) {
    rows.push({
      kind: "group",
      text: `Due by ${showDay(d.until)}`,
      right: formatINR(d.totals.soon),
    });
    rows.push(...billRows(d.soon).map((r) => (r.kind === "group" ? { ...r, kind: "group2" as const } : r)));
  }
  if (!rows.length) rows.push({ kind: "note", text: "Nothing is due this week." });
  rows.push({
    kind: "total",
    cells: ["To pay", "", "", "", formatINR(d.totals.overdue + d.totals.soon), "", ""],
  });
  return {
    title: "Payables: falling due",
    subtitle: [`From ${showDay(d.asOn)} to ${showDay(d.until)}`, filters].filter(Boolean).join(" · "),
    landscape: false,
    cols: billCols,
    rows,
  };
}
export const dueCsv = (d: Due) => [
  ["Status", "Supplier", "Their bill no", "Bill date", "Due date", "Still to pay", "Days late"],
  ...d.overdue.map((b) => ["Late", b.supplier, b.number, b.date, b.dueDate, rupees(b.left), b.late]),
  ...d.soon.map((b) => ["Due soon", b.supplier, b.number, b.date, b.dueDate, rupees(b.left), 0]),
];

// ── payments made ──
export function paymentsSheet(p: Payments, filters = ""): Sheet {
  const rows: SheetRow[] = p.rows.map((r) => ({
    kind: "row",
    cells: [
      showDay(r.date),
      `${r.number}${r.cancelled ? " (cancelled)" : ""}`,
      r.supplier,
      `${PAY_METHOD_LABEL[r.method]}${r.via ? ` · ${r.via}` : ""}`,
      r.cancelled ? "" : formatINR(r.amount),
      r.cancelled || !r.tds ? "" : `${formatINR(r.tds)} ${r.tdsSection ?? ""}`,
    ],
  }));
  rows.push({
    kind: "total",
    cells: ["", n(p.rows.filter((r) => !r.cancelled).length, "payment"), "", "", formatINR(p.totals.paid), amt(p.totals.tds)],
  });
  rows.push({
    kind: "note",
    text: `Bank ${formatINR(p.totals.bank)} · cash ${formatINR(p.totals.cash)} · cheques ${formatINR(p.totals.cheque)}.${p.totals.tds ? ` TDS kept back ${formatINR(p.totals.tds)}.` : ""}`,
  });
  if (p.capped)
    rows.push({
      kind: "note",
      text: "Only the first 3,000 payments are shown. Pick a shorter period for the rest.",
    });
  return {
    title: "Payments to suppliers",
    subtitle: [period(p.from, p.to), filters].filter(Boolean).join(" · "),
    landscape: true,
    cols: [
      { label: "Date", width: 55 },
      { label: "Number", width: 90 },
      { label: "Supplier", width: 170, wrap: true },
      { label: "Paid by", width: 190, wrap: true },
      { label: "Amount", width: 85, align: "r" },
      { label: "TDS", width: 80, align: "r" },
    ],
    rows,
  };
}
export const paymentsCsv = (p: Payments) => [
  ["Date", "Number", "Supplier", "Method", "Via", "Amount", "TDS", "TDS section", "Cheque status", "Cancelled"],
  ...p.rows.map((r) => [r.date, r.number, r.supplier, PAY_METHOD_LABEL[r.method], r.via, rupees(r.amount), rupees(r.tds), r.tdsSection ?? "", r.chequeStatus ?? "", r.cancelled ? "yes" : ""]),
];

/** A short WhatsApp text for the owner. */
export function payablesSummary(
  kind: string,
  data: {
    bySupplier?: BySupplier;
    bills?: Bills;
    asOn: string;
    due?: Due;
    payments?: Payments;
  },
) {
  if (kind === "due" && data.due) {
    const d = data.due;
    return [
      `*Supplier bills to pay* (${showDay(d.asOn)} to ${showDay(d.until)})`,
      `Late already: ${formatINR(d.totals.overdue)} (${n(d.overdue.length, "bill")})`,
      `Due this week: ${formatINR(d.totals.soon)} (${n(d.soon.length, "bill")})`,
    ].join("\n");
  }
  if (kind === "payments" && data.payments) {
    const p = data.payments;
    return [
      `*Payments to suppliers* ${period(p.from, p.to)}`,
      `Paid: ${formatINR(p.totals.paid)} (bank ${formatINR(p.totals.bank)}, cash ${formatINR(p.totals.cash)}, cheques ${formatINR(p.totals.cheque)})`,
      p.totals.tds ? `TDS kept back: ${formatINR(p.totals.tds)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "bills" && data.bills) {
    const b = data.bills;
    return [
      `*Open supplier bills* as on ${showDay(data.asOn)}`,
      `${n(b.length, "bill")}: ${formatINR(b.reduce((a, x) => a + x.left, 0))}`,
      `Late: ${formatINR(b.filter((x) => x.late > 0).reduce((a, x) => a + x.left, 0))}`,
    ].join("\n");
  }
  const r = data.bySupplier!;
  const top = r.rows.slice(0, 5).map((s) => `• ${s.name}: ${formatINR(s.owed)}`);
  return [`*We owe suppliers* as on ${showDay(r.asOn)}`, `Total: ${formatINR(r.totals.owed)}`, `Late over 30 days: ${formatINR(r.totals.d60 + r.totals.d90 + r.totals.older)}`, ...top].join("\n");
}
