import { formatINR } from "@/lib/money";
import type { Sheet, SheetRow } from "@/lib/dues-export";
import { showDay } from "@/lib/books";
import { VALUATION_BY } from "@/lib/stock-count-labels";
import type { countDetail, stockValuation } from "@/lib/stock-counts";

/** PDF and CSV of the stock valuation, a count sheet to fill in, and an accepted count. */

type Valuation = Awaited<ReturnType<typeof stockValuation>>;
type Count = Awaited<ReturnType<typeof countDetail>>;

const amt = (p: number) => (p ? formatINR(p) : "");
const rupees = (p: number | null) => (p === null ? "" : (p / 100).toFixed(2));
const qty = (q: number) => q.toLocaleString("en-IN");
const signed = (q: number | null) => (q === null ? "" : q > 0 ? `+${qty(q)}` : q < 0 ? `−${qty(-q)}` : "0");
const signedAmt = (p: number | null) => (p === null || p === 0 ? "" : p > 0 ? `+${formatINR(p)}` : `−${formatINR(-p)}`);

function filterLine(v: Valuation) {
  return [v.filters.place, v.filters.company, v.filters.category].filter(Boolean).join(" · ");
}

export function valuationSheet(v: Valuation): Sheet {
  const byLabel = VALUATION_BY.find((b) => b.key === v.by)?.label ?? "Company";
  const rows: SheetRow[] = [];
  if (v.by !== "product") {
    rows.push({ kind: "group", text: `By ${byLabel.toLowerCase()}` });
    for (const g of v.groups) rows.push({ kind: "row", cells: [g.name, `${g.products} products`, qty(g.qty), "", formatINR(g.value)] });
    rows.push({ kind: "total", cells: ["Total", "", qty(v.units), "", formatINR(v.total)] });
    rows.push({ kind: "group", text: "Product-wise" });
  }
  for (const r of v.rows) {
    const flag = r.noCost ? " (no cost)" : r.atLastCost ? " (last cost)" : "";
    rows.push({ kind: "row", cells: [`${r.name}${flag}`, r.company, `${qty(r.qty)} ${r.unit}`, r.qty ? formatINR(Math.round(r.value / r.qty)) : "", formatINR(r.value)] });
  }
  rows.push({ kind: "total", cells: ["Closing stock at cost", "", qty(v.units), "", formatINR(v.total)] });
  if (v.damaged) rows.push({ kind: "note", text: `Not included: ${formatINR(v.damaged)} of damaged and expired goods (${qty(v.damagedUnits)} units) in the damaged bin.` });
  if (v.atLastCost) rows.push({ kind: "note", text: `${v.atLastCost} products have batches with no cost of their own; they are valued at the product's last cost.` });
  if (v.noCost) rows.push({ kind: "note", text: `${v.noCost} products have no cost at all and are valued at ₹0. Enter a purchase bill or a cost for them.` });
  return {
    title: "Stock valuation at cost",
    subtitle: [`As at the end of ${showDay(v.day)}`, filterLine(v)].filter(Boolean).join(" · "),
    landscape: false,
    cols: [
      { label: "Product", width: 190, wrap: true },
      { label: "Company", width: 110, wrap: true },
      { label: "Quantity", width: 70, align: "r" },
      { label: "Rate", width: 60, align: "r" },
      { label: "Value", width: 85, align: "r" },
    ],
    rows,
  };
}

export function valuationCsv(v: Valuation) {
  return [
    ["Product", "Code", "Company", "Category", "Quantity", "Unit", "Average rate", "Value", "Cost from"],
    ...v.rows.map((r) => [
      r.name,
      r.sku,
      r.company,
      r.category,
      String(r.qty),
      r.unit,
      r.qty ? rupees(Math.round(r.value / r.qty)) : "",
      rupees(r.value),
      r.noCost ? "no cost" : r.atLastCost ? "last cost (some batches)" : "batch cost",
    ]),
    ["Total", "", "", "", String(v.units), "", "", rupees(v.total), ""],
  ];
}

const countTitle = (c: Count) => [c.place, c.company, c.category].filter(Boolean).join(" · ");

/** The count: blank to fill in while counting, or with the app's quantities and the differences once accepted. */
export function countSheet(c: Count): Sheet {
  const head = `${c.number} · ${showDay(c.date)}${countTitle(c) ? ` · ${countTitle(c)}` : ""}`;
  if (c.mode === "VALUE") {
    const rows: SheetRow[] = c.lines.map((l) => ({ kind: "row", cells: [String(l.sl), l.name, l.value === null ? "" : formatINR(l.value)] }));
    rows.push({ kind: "total", cells: ["", "Closing stock", formatINR(c.totals.countedValue)] });
    return {
      title: `Stock by company, ${c.statusLabel.toLowerCase()}`,
      subtitle: head,
      landscape: false,
      cols: [
        { label: "Sl", width: 30 },
        { label: "Company", width: 330, wrap: true },
        { label: "Stock value", width: 120, align: "r" },
      ],
      rows,
    };
  }
  if (c.status === "DRAFT") {
    // Blind: the app's quantity is not printed, so the count is honest.
    const rows: SheetRow[] = c.lines.map((l) => ({
      kind: "row",
      cells: [String(l.sl), l.name, l.sku ?? "", [l.batch, l.expiry ? `exp ${showDay(l.expiry)}` : ""].filter(Boolean).join(" · "), l.unit ?? "", l.countedQty === null ? "" : qty(l.countedQty)],
    }));
    rows.push({ kind: "note", text: "Count what is on the shelf at the end of the day. Write any product or batch not on this sheet at the bottom." });
    return {
      title: "Stock count sheet",
      subtitle: head,
      landscape: false,
      cols: [
        { label: "Sl", width: 28 },
        { label: "Product", width: 200, wrap: true },
        { label: "Code", width: 70 },
        { label: "Batch / expiry", width: 95, wrap: true },
        { label: "Unit", width: 40 },
        { label: "Counted", width: 70, align: "r" },
      ],
      rows,
    };
  }
  const tracked = c.mode === "TRACKED";
  const rows: SheetRow[] = c.lines.map((l) => ({
    kind: "row",
    cells: tracked
      ? [String(l.sl), `${l.name}${l.batch ? ` · ${l.batch}` : ""}`, qty(l.bookQty), l.countedQty === null ? "" : qty(l.countedQty), signed(l.diffQty), amt(l.rate ?? 0), signedAmt(l.diffValue)]
      : [String(l.sl), l.name, l.countedQty === null ? "" : `${qty(l.countedQty)} ${l.unit ?? ""}`, amt(l.rate ?? 0), amt(l.countedValue ?? 0)],
  }));
  if (tracked) {
    rows.push({ kind: "total", cells: ["", "At cost: the app's stock", "", "", "", "", formatINR(c.totals.bookValue)] });
    rows.push({ kind: "total", cells: ["", "Counted", "", "", "", "", formatINR(c.totals.countedValue)] });
    rows.push({ kind: "total", cells: ["", `Shortage ${formatINR(c.totals.shortage)}, excess ${formatINR(c.totals.excess)}`, "", "", "", "", signedAmt(c.totals.excess - c.totals.shortage) || "0"] });
  } else {
    rows.push({ kind: "total", cells: ["", "Closing stock", "", "", formatINR(c.totals.countedValue)] });
  }
  return {
    title: `Stock count, ${c.statusLabel.toLowerCase()}`,
    subtitle: head,
    landscape: tracked,
    cols: tracked
      ? [
          { label: "Sl", width: 30 },
          { label: "Product · batch", width: 300, wrap: true },
          { label: "In the app", width: 70, align: "r" },
          { label: "Counted", width: 70, align: "r" },
          { label: "Difference", width: 70, align: "r" },
          { label: "Rate", width: 70, align: "r" },
          { label: "Difference ₹", width: 90, align: "r" },
        ]
      : [
          { label: "Sl", width: 30 },
          { label: "Product", width: 240, wrap: true },
          { label: "Quantity", width: 80, align: "r" },
          { label: "Rate", width: 60, align: "r" },
          { label: "Value", width: 80, align: "r" },
        ],
    rows,
  };
}

export function countCsv(c: Count) {
  if (c.mode === "VALUE") return [["Sl", "Company", "Stock value"], ...c.lines.map((l) => [String(l.sl), l.name, rupees(l.value)])];
  return [
    ["Sl", "Product", "Code", "Company", "Batch", "Expiry", "Unit", "In the app", "Counted", "Difference", "Rate", "Counted value", "Difference value", "Note"],
    ...c.lines.map((l) => [
      String(l.sl),
      l.name,
      l.sku ?? "",
      l.company ?? "",
      l.batch,
      l.expiry ?? "",
      l.unit ?? "",
      c.mode === "TRACKED" ? String(l.bookQty) : "",
      l.countedQty === null ? "" : String(l.countedQty),
      l.diffQty === null ? "" : String(l.diffQty),
      rupees(l.rate),
      rupees(l.countedValue),
      rupees(l.diffValue),
      l.note ?? "",
    ]),
  ];
}
