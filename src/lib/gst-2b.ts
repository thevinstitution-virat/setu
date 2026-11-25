import ExcelJS from "exceljs";
import { normaliseGstin } from "@/lib/gst";
import { parseCsv } from "@/lib/importers";
import { numberKey } from "@/lib/gst-math";

/**
 * Reads a GSTR-2B file as the GST portal gives it: the JSON download, the
 * Excel download (sheets "B2B" and "B2B-CDNR", headers found by their
 * wording), or a CSV with one header row in the same words. Only supplier
 * bills and their credit / debit notes are read (B2B, B2BA, CDNR, CDNRA).
 */

export type Row2b = {
  kind: "INV" | "CN" | "DN";
  gstin: string;
  name: string | null;
  number: string;
  numberKey: string;
  /** "YYYY-MM-DD" or null. */
  date: string | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  total: number;
  reverseCharge: boolean;
  itcAvailable: boolean;
};

export type Parsed2b = { period: string | null; gstin: string | null; rows: Row2b[]; skipped: number };

export class Gstr2bError extends Error {}

const paise = (v: unknown) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹\s]/g, ""));
  if (!Number.isFinite(n)) throw new Gstr2bError(`"${String(v)}" is not an amount`);
  return Math.round(n * 100);
};

/** dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd, a date, or an Excel serial. */
function day(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86_400_000).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s);
  if (m) {
    const mi = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

const yes = (v: unknown, dflt: boolean) => {
  const s = String(v ?? "")
    .trim()
    .toUpperCase();
  if (!s) return dflt;
  return s === "Y" || s === "YES" || s === "T" || s === "TRUE";
};

function row(r: Omit<Row2b, "numberKey" | "gstin" | "number"> & { gstin: string; number: string }): Row2b | null {
  const gstin = normaliseGstin(r.gstin);
  const number = String(r.number ?? "").trim();
  if (!gstin || !number) return null;
  return { ...r, gstin, number: number.slice(0, 40), numberKey: numberKey(number), name: r.name ? String(r.name).trim().slice(0, 120) : null };
}

// ───────────────────────────── JSON ─────────────────────────────

type J = Record<string, unknown>;
const arr = (v: unknown) => (Array.isArray(v) ? (v as J[]) : []);

/** Tax of a document: its own totals, else the sum of its items. */
function taxOf(d: J) {
  const items = arr(d.items).length ? arr(d.items) : arr(d.itms).map((i) => (i.itm_det as J) ?? i);
  const pick = (k: string) => (d[k] !== undefined ? paise(d[k]) : items.reduce((a, i) => a + paise(i[k]), 0));
  return { taxable: pick("txval"), igst: pick("igst"), cgst: pick("cgst"), sgst: pick("sgst"), cess: pick("cess") };
}

function fromJson(o: J): Parsed2b {
  const data = (o.data as J) ?? o;
  const docs = (data.docdata as J) ?? data;
  const rtn = String(data.rtnprd ?? data.ret_period ?? "");
  const period = /^\d{6}$/.test(rtn) ? `${rtn.slice(2)}-${rtn.slice(0, 2)}` : null;
  const rows: Row2b[] = [];
  let skipped = 0;
  for (const key of ["b2b", "b2ba"]) {
    for (const s of arr(docs[key])) {
      for (const d of arr(s.inv)) {
        const r = row({
          kind: "INV",
          gstin: String(s.ctin ?? ""),
          name: (s.trdnm as string) ?? null,
          number: String(d.inum ?? ""),
          date: day(d.dt ?? d.idt),
          ...taxOf(d),
          total: paise(d.val),
          reverseCharge: yes(d.rev, false),
          itcAvailable: yes(d.itcavl, true),
        });
        if (r) rows.push(r);
        else skipped++;
      }
    }
  }
  for (const key of ["cdnr", "cdnra"]) {
    for (const s of arr(docs[key])) {
      for (const d of arr(s.nt)) {
        const r = row({
          kind: String(d.typ ?? d.ntty ?? "C").toUpperCase() === "D" ? "DN" : "CN",
          gstin: String(s.ctin ?? ""),
          name: (s.trdnm as string) ?? null,
          number: String(d.ntnum ?? d.nt_num ?? ""),
          date: day(d.dt ?? d.nt_dt),
          ...taxOf(d),
          total: paise(d.val),
          reverseCharge: yes(d.rev, false),
          itcAvailable: yes(d.itcavl, true),
        });
        if (r) rows.push(r);
        else skipped++;
      }
    }
  }
  return { period, gstin: normaliseGstin(data.gstin) || null, rows, skipped };
}

// ───────────────────────────── tables (Excel / CSV) ─────────────────────────────

type Col = keyof typeof WORDS;
const WORDS = {
  gstin: /gstin/,
  name: /trade|legal name/,
  number: /(invoice|note) (no|number)/,
  noteType: /note type/,
  date: /(invoice|note) date/,
  value: /(invoice|note) value/,
  taxable: /taxable value/,
  igst: /integrated tax|igst/,
  cgst: /central tax|cgst/,
  sgst: /state\/?ut tax|sgst/,
  cess: /cess/,
  rcm: /reverse charge/,
  itc: /itc availab/,
};

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v && "richText" in v) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  if (typeof v === "object" && v && "result" in v) return String((v as { result: unknown }).result ?? "");
  if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text ?? "");
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
};
const cellValue = (v: unknown): unknown => (v && typeof v === "object" && !(v instanceof Date) ? ("result" in v ? (v as { result: unknown }).result : cellText(v)) : v);

/** Rows of a table whose header is found by its words (up to two header rows, as on the portal's sheets). */
function fromTable(grid: unknown[][], kindOf: (r: Record<Col, unknown>) => Row2b["kind"]): { rows: Row2b[]; skipped: number } | null {
  const hi = grid.slice(0, 15).findIndex((r) => r.some((c) => /gstin/i.test(cellText(c))) && r.some((c) => /(invoice|note).*(no|number)|taxable/i.test(cellText(c))));
  if (hi < 0) {
    // The portal puts "GSTIN of supplier" in one row and "Invoice number" in the row under it.
    const top = grid.slice(0, 15).findIndex((r) => r.some((c) => /gstin of supplier/i.test(cellText(c))));
    if (top < 0) return null;
    return read(grid, top, 2, kindOf);
  }
  const two = grid[hi + 1]?.some((c) => /integrated tax|central tax|invoice number|note number/i.test(cellText(c)));
  return read(grid, hi, two ? 2 : 1, kindOf);
}

function read(grid: unknown[][], at: number, depth: number, kindOf: (r: Record<Col, unknown>) => Row2b["kind"]) {
  const width = Math.max(...grid.slice(at, at + depth).map((r) => r.length));
  const map = new Map<Col, number>();
  for (let c = 0; c < width; c++) {
    const words = grid
      .slice(at, at + depth)
      .map((r) => cellText(r[c]))
      .join(" ")
      .toLowerCase()
      .replace(/\s+/g, " ");
    for (const [k, re] of Object.entries(WORDS) as [Col, RegExp][]) if (!map.has(k) && re.test(words)) map.set(k, c);
  }
  for (const need of ["gstin", "number", "taxable"] as Col[])
    if (!map.has(need)) throw new Gstr2bError(`The file has no "${need === "number" ? "invoice number" : need === "taxable" ? "taxable value" : "GSTIN"}" column`);
  const rows: Row2b[] = [];
  let skipped = 0;
  for (const g of grid.slice(at + depth)) {
    const get = (k: Col) => (map.has(k) ? cellValue(g[map.get(k)!]) : undefined);
    const rec = Object.fromEntries((Object.keys(WORDS) as Col[]).map((k) => [k, get(k)])) as Record<Col, unknown>;
    if (!cellText(rec.gstin).trim() && !cellText(rec.number).trim()) continue;
    if (/total/i.test(cellText(rec.gstin))) continue;
    const r = row({
      kind: kindOf(rec),
      gstin: cellText(rec.gstin),
      name: cellText(rec.name) || null,
      number: cellText(rec.number),
      date: day(rec.date),
      taxable: paise(rec.taxable),
      igst: paise(rec.igst),
      cgst: paise(rec.cgst),
      sgst: paise(rec.sgst),
      cess: paise(rec.cess),
      total: paise(rec.value),
      reverseCharge: yes(rec.rcm, false),
      itcAvailable: yes(rec.itc, true),
    });
    if (r) rows.push(r);
    else skipped++;
  }
  return { rows, skipped };
}

const noteKind = (r: Record<Col, unknown>): Row2b["kind"] => {
  const t = cellText(r.noteType).trim().toUpperCase();
  return t.startsWith("D") ? "DN" : t.startsWith("C") ? "CN" : "INV";
};

async function fromXlsx(buf: Buffer): Promise<Parsed2b> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new Gstr2bError("The Excel file could not be read");
  }
  const rows: Row2b[] = [];
  let skipped = 0;
  let found = false;
  for (const ws of wb.worksheets) {
    const name = ws.name.toUpperCase().replace(/\s+/g, "");
    const isNote = /CDNR/.test(name);
    if (!(name === "B2B" || name === "B2BA" || isNote) || /ISD|IMPG/.test(name)) continue;
    const grid: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (r, i) => {
      grid[i - 1] = (r.values as unknown[]).slice(1);
    });
    for (let i = 0; i < grid.length; i++) grid[i] ??= [];
    const got = fromTable(grid, isNote ? (r) => (noteKind(r) === "INV" ? "CN" : noteKind(r)) : () => "INV");
    if (!got) continue;
    found = true;
    rows.push(...got.rows);
    skipped += got.skipped;
  }
  if (!found) throw new Gstr2bError('No "B2B" sheet with a GSTIN column was found. Upload the GSTR-2B Excel or JSON from the GST portal.');
  return { period: null, gstin: null, rows, skipped };
}

function fromCsv(text: string): Parsed2b {
  const grid = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const got = fromTable(grid, noteKind);
  if (!got) throw new Gstr2bError("The CSV has no header row with GSTIN, invoice number and taxable value");
  return { period: null, gstin: null, rows: got.rows, skipped: got.skipped };
}

/** Read an uploaded GSTR-2B file (.json, .xlsx or .csv). */
export async function parse2b(buf: Buffer, fileName: string): Promise<Parsed2b> {
  const lower = fileName.toLowerCase();
  const head = buf.subarray(0, 4).toString("latin1");
  if (lower.endsWith(".xlsx") || head.startsWith("PK")) return fromXlsx(buf);
  const text = buf.toString("utf8").replace(/^﻿/, "");
  if (lower.endsWith(".json") || /^\s*[{[]/.test(text)) {
    let o: unknown;
    try {
      o = JSON.parse(text);
    } catch {
      throw new Gstr2bError("The JSON file could not be read");
    }
    return fromJson(o as J);
  }
  return fromCsv(text);
}
