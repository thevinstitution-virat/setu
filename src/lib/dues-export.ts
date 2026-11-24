/**
 * The outstanding / collection reports as a printable sheet (A4 PDF), a flat
 * CSV and a short WhatsApp summary. Server-side only (the PDF reads fonts).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatINR } from "@/lib/money";
import { COLLECTION_METHODS, DUES_TITLE, METHOD_LABEL, UNSPLIT, count, historyText, shortDate, type DuesReport, type PartyBlock } from "@/lib/dues-reports";

const money = (p: number) => formatINR(p, { symbol: false });
const rupees = (p: number) => (p / 100).toFixed(2);

export type Col = { label: string; width: number; align?: "l" | "r"; wrap?: boolean };
export type SheetRow =
  | { kind: "row" | "sub" | "total"; cells: string[] }
  | { kind: "group" | "group2" | "note"; text: string; right?: string };
export type Sheet = { title: string; subtitle: string; landscape: boolean; cols: Col[]; rows: SheetRow[] };

function asOnLine(r: DuesReport, filters: string) {
  const when = r.view === "collections" ? (r.period.from === r.period.to ? `On ${shortDate(r.period.from)}` : `${shortDate(r.period.from)} to ${shortDate(r.period.to)}`) : `As on ${shortDate(r.asOn)}`;
  return [when, filters].filter(Boolean).join(" · ");
}

const adv = (p: number) => (p > 0 ? `(advance −${money(p)})` : "");

function partyNote(p: PartyBlock) {
  const s = p.shop;
  const phones = [s.phone, s.altPhone].filter(Boolean).join(" / ");
  const bits = [s.address, phones && `Ph ${phones}`, s.contactName && `Contact: ${s.contactName}`];
  bits.push(p.lastReceipt ? `Last receipt ${money(p.lastReceipt.amount)} on ${shortDate(p.lastReceipt.date)} (${count(p.lastReceipt.daysAgo, "day")} ago)` : "No receipt yet");
  return bits.filter(Boolean).join(" · ");
}

export function sheetFor(r: DuesReport, filters: string): Sheet {
  const title = DUES_TITLE[r.view];
  const subtitle = asOnLine(r, filters);
  if (r.view === "bills") {
    return {
      title,
      subtitle,
      landscape: true,
      cols: [
        { label: "Bill no.", width: 70 },
        { label: "Date", width: 46 },
        { label: "Party", width: 150 },
        { label: "Area", width: 80 },
        { label: "Salesman", width: 80 },
        { label: "Bill value", width: 66, align: "r" },
        { label: "Received", width: 66, align: "r" },
        { label: "Balance", width: 66, align: "r" },
        { label: "Due date", width: 46 },
        { label: "Days over", width: 42, align: "r" },
      ],
      rows: [
        ...r.bills.map((b): SheetRow => ({
          kind: "row",
          cells: [b.number, shortDate(b.date), b.shop.outletName, b.shop.area, b.salesman?.name ?? "", money(b.amount), money(b.received), money(b.balance), shortDate(b.dueDate), b.overdueDays ? String(b.overdueDays) : ""],
        })),
        { kind: "total", cells: [count(r.bills.length, "bill"), "", count(r.shops, "party", "parties"), "", "", money(r.totals.amount), money(r.totals.received), money(r.totals.balance), "", ""] },
      ],
    };
  }
  if (r.view === "parties") {
    const rows: SheetRow[] = [];
    for (const p of r.parties) {
      rows.push({ kind: "group", text: `${p.shop.outletName} — ${p.shop.area}`, right: money(p.totals.balance) });
      rows.push({ kind: "note", text: partyNote(p) });
      for (const b of p.bills) rows.push({ kind: "row", cells: [b.number, shortDate(b.date), money(b.amount), money(b.received), money(b.balance), String(b.age), historyText(b.collections, money)] });
      rows.push({ kind: "sub", cells: [count(p.bills.length, "bill"), "", money(p.totals.amount), money(p.totals.received), money(p.totals.balance), "", adv(p.advance)] });
    }
    rows.push({ kind: "total", cells: [count(r.parties.length, "party", "parties"), "", money(r.totals.amount), money(r.totals.received), money(r.totals.balance), "", adv(r.advance)] });
    return {
      title,
      subtitle,
      landscape: false,
      cols: [
        { label: "Bill no.", width: 66 },
        { label: "Date", width: 44 },
        { label: "Bill value", width: 62, align: "r" },
        { label: "Received", width: 62, align: "r" },
        { label: "Balance", width: 62, align: "r" },
        { label: "Days", width: 30, align: "r" },
        { label: "Collections on this bill", width: 197, wrap: true },
      ],
      rows,
    };
  }
  if (r.view === "agents") {
    const rows: SheetRow[] = [];
    for (const a of r.agents) {
      rows.push({ kind: "group", text: a.salesman?.name ?? "No salesman", right: money(a.totals.balance) });
      for (const p of a.parties) {
        rows.push({ kind: "group2", text: `${p.shop.outletName} — ${p.shop.area}` });
        for (const b of p.bills) rows.push({ kind: "row", cells: [b.number, shortDate(b.date), money(b.amount), money(b.received), money(b.balance), String(b.age), b.overdueDays ? String(b.overdueDays) : "", ""] });
        rows.push({ kind: "sub", cells: ["Party total", "", money(p.totals.amount), money(p.totals.received), money(p.totals.balance), "", "", adv(p.advance)] });
      }
      rows.push({ kind: "sub", cells: [`${a.salesman?.name ?? "No salesman"} total`, "", money(a.totals.amount), money(a.totals.received), money(a.totals.balance), "", "", adv(a.advance)] });
    }
    rows.push({ kind: "total", cells: ["Grand total", "", money(r.totals.amount), money(r.totals.received), money(r.totals.balance), "", "", adv(r.advance)] });
    return {
      title,
      subtitle,
      landscape: false,
      cols: [
        { label: "Bill no.", width: 80 },
        { label: "Date", width: 50 },
        { label: "Bill value", width: 74, align: "r" },
        { label: "Received", width: 74, align: "r" },
        { label: "Balance", width: 74, align: "r" },
        { label: "Days", width: 40, align: "r" },
        { label: "Days over", width: 50, align: "r" },
        { label: "", width: 81, align: "r" },
      ],
      rows,
    };
  }
  if (r.view === "companies") {
    const rows: SheetRow[] = [];
    for (const c of r.companies) {
      rows.push({ kind: "group", text: `${c.company} — ${count(c.rows.length, "bill")}, ${count(c.parties, "party", "parties")}`, right: money(c.totals.balance) });
      for (const { bill: b, share: x } of c.rows) {
        rows.push({ kind: "row", cells: [b.number, shortDate(b.date), b.shop.outletName, b.shop.area, money(b.amount), money(x.amount), money(x.received), money(x.balance), b.overdueDays ? String(b.overdueDays) : ""] });
      }
      rows.push({ kind: "sub", cells: [`${c.company} total`, "", "", "", "", money(c.totals.amount), money(c.totals.received), money(c.totals.balance), ""] });
    }
    rows.push({ kind: "total", cells: ["Grand total", "", count(r.companies.filter((c) => c.companyId).length, "company", "companies"), "", "", money(r.totals.amount), money(r.totals.received), money(r.totals.balance), ""] });
    if (r.companies.some((c) => c.key === UNSPLIT)) rows.push({ kind: "note", text: "Not split: bills from the old book with no company split imported yet (Import → Company split of open bills)." });
    return {
      title,
      subtitle,
      landscape: true,
      cols: [
        { label: "Bill no.", width: 70 },
        { label: "Date", width: 46 },
        { label: "Party", width: 160 },
        { label: "Area", width: 90 },
        { label: "Bill value", width: 70, align: "r" },
        { label: "Company share", width: 76, align: "r" },
        { label: "Received", width: 70, align: "r" },
        { label: "Balance", width: 70, align: "r" },
        { label: "Days over", width: 46, align: "r" },
      ],
      rows,
    };
  }
  return {
    title,
    subtitle,
    landscape: true,
    cols: [
      { label: "Party", width: 170 },
      { label: "Area", width: 90 },
      { label: "Collected by", width: 110 },
      ...COLLECTION_METHODS.map((m): Col => ({ label: METHOD_LABEL[m], width: 62, align: "r" })),
      { label: "Total", width: 72, align: "r" },
    ],
    rows: [
      ...r.rows.map((x): SheetRow => ({ kind: "row", cells: [x.shop.outletName, x.shop.area, x.collectors.join(", "), ...COLLECTION_METHODS.map((m) => (x.byMethod[m] ? money(x.byMethod[m]) : "")), money(x.total)] })),
      { kind: "total", cells: [count(r.rows.length, "party", "parties"), "", count(r.totals.count, "receipt"), ...COLLECTION_METHODS.map((m) => money(r.totals.byMethod[m])), money(r.totals.total)] },
      ...(r.pending.count ? [{ kind: "note" as const, text: `Not counted: ${r.pending.count} UPI / bank payments for ${money(r.pending.amount)} are waiting to be checked.` }] : []),
    ],
  };
}

/** One flat row per bill (or per party for collections), amounts in rupees. */
export function csvFor(r: DuesReport): (string | number | null)[][] {
  if (r.view === "collections") {
    return [
      ["Party", "Area", "Phone", "Salesman", "Collected by", "Receipts", ...COLLECTION_METHODS.map((m) => METHOD_LABEL[m]), "Total"],
      ...r.rows.map((x) => [x.shop.outletName, x.shop.area, x.shop.phone, x.shop.agent?.name ?? "", x.collectors.join(", "), x.count, ...COLLECTION_METHODS.map((m) => rupees(x.byMethod[m])), rupees(x.total)]),
    ];
  }
  if (r.view === "companies") {
    return [
      ["Company", "Party", "Area", "Phone", "Salesman", "Bill no.", "Bill date", "Due date", "Bill value", "Company share", "Received", "Balance", "Days over"],
      ...r.companies.flatMap((c) =>
        c.rows.map(({ bill: b, share: x }) => [c.company, b.shop.outletName, b.shop.area, b.shop.phone, b.salesman?.name ?? "", b.number, shortDate(b.date), shortDate(b.dueDate), rupees(b.amount), rupees(x.amount), rupees(x.received), rupees(x.balance), b.overdueDays])
      ),
    ];
  }
  const head = ["Salesman", "Party", "Area", "Phone", "Other phone", "Contact", "Bill no.", "Bill date", "Due date", "Bill value", "Received", "Balance", "Days", "Days over", "Collections", "Party advance", "Last receipt", "Last receipt date"];
  const bills =
    r.view === "bills" ? r.bills.map((b) => ({ b, p: null as PartyBlock | null })) : (r.view === "parties" ? r.parties : r.agents.flatMap((a) => a.parties)).flatMap((p) => p.bills.map((b) => ({ b, p })));
  return [
    head,
    ...bills.map(({ b, p }) => [
      b.salesman?.name ?? "",
      b.shop.outletName,
      b.shop.area,
      b.shop.phone,
      b.shop.altPhone,
      b.shop.contactName,
      b.number,
      shortDate(b.date),
      shortDate(b.dueDate),
      rupees(b.amount),
      rupees(b.received),
      rupees(b.balance),
      b.age,
      b.overdueDays,
      historyText(b.collections, (x) => rupees(x)),
      p ? rupees(p.advance) : "",
      p?.lastReceipt ? rupees(p.lastReceipt.amount) : "",
      p?.lastReceipt ? shortDate(p.lastReceipt.date) : "",
    ]),
  ];
}

/** Two or three lines for a WhatsApp message that goes with the PDF. */
export function summaryText(r: DuesReport, business: string, filters: string) {
  const head = `${business}: ${DUES_TITLE[r.view]} (${asOnLine(r, filters)})`;
  if (r.view === "collections") return `${head}\nCollected ₹${money(r.totals.total)} from ${count(r.rows.length, "party", "parties")} (${COLLECTION_METHODS.filter((m) => r.totals.byMethod[m]).map((m) => `${METHOD_LABEL[m]} ₹${money(r.totals.byMethod[m])}`).join(", ") || "nothing yet"}).`;
  if (r.view === "companies") return `${head}\nOutstanding ₹${money(r.totals.balance)} across ${count(r.companies.filter((c) => c.companyId).length, "company", "companies")} (${r.companies.slice(0, 4).map((c) => `${c.company} ₹${money(c.totals.balance)}`).join(", ")}${r.companies.length > 4 ? ", …" : ""}).`;
  const n = r.view === "bills" ? r.bills.length : r.view === "parties" ? r.parties.reduce((s, p) => s + p.bills.length, 0) : r.agents.reduce((s, a) => s + a.parties.reduce((t, p) => t + p.bills.length, 0), 0);
  return `${head}\nOutstanding ₹${money(r.totals.balance)} on ${count(n, "bill")}.`;
}

// ───────────────────────────── PDF ─────────────────────────────

const INK = rgb(0.12, 0.12, 0.14);
const MUTED = rgb(0.42, 0.42, 0.46);
const LINE = rgb(0.82, 0.82, 0.85);
const BAND = rgb(0.95, 0.94, 0.92);
const M = 28;

let fontCache: Promise<[Uint8Array, Uint8Array]> | null = null;
function fontBytes() {
  const load = (f: string) => readFile(path.join(process.cwd(), "assets", "fonts", f)).then((b) => new Uint8Array(b));
  fontCache ??= Promise.all([load("Geist-Regular.ttf"), load("Geist-SemiBold.ttf")]);
  return fontCache;
}

function fit(font: PDFFont, s: string, size: number, width: number) {
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

function wrap(font: PDFFont, s: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) out.push(line);
      line = fit(font, word, size, width);
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

/** A4 table: header on every page, group bands, subtotals, page numbers. */
export async function renderSheetPdf(sheet: Sheet, business: { name: string; address?: string | null; gstin?: string | null }, printedAt = new Date()) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [r, b] = await fontBytes();
  const reg = await pdf.embedFont(r, { subset: true });
  const bold = await pdf.embedFont(b, { subset: true });
  const [W, H] = sheet.landscape ? [841.89, 595.28] : [595.28, 841.89];
  const usable = W - 2 * M;
  // Columns stretch to the page width.
  const scale = usable / sheet.cols.reduce((s, c) => s + c.width, 0);
  const cols = sheet.cols.map((c) => ({ ...c, width: c.width * scale }));
  const xs = cols.reduce<number[]>((a, _c, i) => [...a, i ? a[i - 1] + cols[i - 1].width : M], []);
  const SIZE = 7.6;
  const LH = 10.5;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const t = (s: string, x: number, yy: number, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; width?: number; align?: "l" | "r" } = {}) => {
    const size = o.size ?? SIZE;
    const font = o.bold ? bold : reg;
    const str = o.width ? fit(font, s, size, o.width) : s;
    const dx = o.align === "r" && o.width ? x + o.width - font.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: dx, y: yy, size, font, color: o.color ?? INK });
  };

  const header = () => {
    page = pdf.addPage([W, H]);
    pages.push(page);
    y = H - M;
    t(business.name, M, y - 10, { size: 12, bold: true });
    t(sheet.title, W - M - bold.widthOfTextAtSize(sheet.title, 11), y - 10, { size: 11, bold: true });
    y -= 24;
    const sub = [business.address, business.gstin && `GSTIN ${business.gstin}`].filter(Boolean).join(" · ");
    if (sub) t(fit(reg, sub, 7.5, usable / 2), M, y, { size: 7.5, color: MUTED });
    t(sheet.subtitle, W - M - reg.widthOfTextAtSize(sheet.subtitle, 8), y, { size: 8, color: MUTED });
    y -= 10;
    page.drawRectangle({ x: M, y: y - 14, width: usable, height: 14, color: BAND });
    cols.forEach((c, i) => {
      const pad = i > 0 && cols[i - 1].align === "r" && c.align !== "r" ? 9 : 3;
      t(c.label, xs[i] + pad, y - 10, { bold: true, width: c.width - pad - 3, align: c.align });
    });
    y -= 18;
  };

  const room = (h: number) => {
    if (y - h < M + 16) header();
  };

  header();
  for (const row of sheet.rows) {
    if (row.kind === "group" || row.kind === "group2") {
      const big = row.kind === "group";
      room(big ? 30 : 22);
      y -= big ? 4 : 2;
      if (big) page.drawRectangle({ x: M, y: y - 12, width: usable, height: 13, color: BAND });
      t(row.text, M + 3, y - 9, { size: big ? 8.6 : 8, bold: true, width: usable * 0.75 });
      if (row.right) t(row.right, M + usable * 0.75, y - 9, { size: 8.6, bold: true, width: usable * 0.25 - 3, align: "r" });
      y -= 14;
      continue;
    }
    if (row.kind === "note") {
      const lines = wrap(reg, row.text, 7, usable - 6);
      room(lines.length * 9 + 2);
      for (const l of lines) {
        t(l, M + 3, y - 7, { size: 7, color: MUTED });
        y -= 9;
      }
      y -= 2;
      continue;
    }
    if (!("cells" in row)) continue;
    const strong = row.kind !== "row";
    const font = strong ? bold : reg;
    const cellLines = row.cells.map((c, i) => (cols[i]?.wrap ? wrap(font, c, SIZE, cols[i].width - 6) : [c]));
    const h = Math.max(1, ...cellLines.map((l) => l.length)) * LH + 2;
    room(h + (row.kind === "total" ? 6 : 0));
    if (strong) page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: row.kind === "total" ? 0.9 : 0.5, color: row.kind === "total" ? INK : LINE });
    if (row.kind === "total") y -= 2;
    cellLines.forEach((lines, i) => {
      const c = cols[i];
      // A left-aligned label in a total row may run on into the empty cells after it.
      let width = c.width;
      if (strong && c.align !== "r") for (let j = i + 1; j < cols.length && !row.cells[j] && cols[j].align !== "r"; j++) width += cols[j].width;
      // Keep left text clear of a right-aligned number just before it.
      const pad = i > 0 && cols[i - 1].align === "r" && c.align !== "r" ? 9 : 3;
      lines.forEach((l, k) => t(l, xs[i] + pad, y - 8 - k * LH, { bold: strong, width: width - pad - 3, align: c.align }));
    });
    y -= h;
    if (row.kind === "sub") y -= 3;
  }

  const stamp = `Printed ${printedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;
  pages.forEach((p, i) => {
    page = p;
    t(stamp, M, M - 8, { size: 7, color: MUTED });
    const n = `Page ${i + 1} of ${pages.length}`;
    t(n, W - M - reg.widthOfTextAtSize(n, 7), M - 8, { size: 7, color: MUTED });
  });
  return pdf.save();
}
