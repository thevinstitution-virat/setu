import { toPaise } from "@/lib/money";

/**
 * Bulk import of retailers and products from CSV or Excel (.xlsx).
 * Two steps: preview (validate every row, change nothing) → commit
 * (all rows in one transaction). Existing records are matched and updated:
 * retailers by phone, products by SKU.
 */

export type ImportType = "retailers" | "products" | "balances";
export type Row = Record<string, string>;
export type RowError = { row: number; message: string };

export const MAX_ROWS = 5000;

export const TEMPLATES: Record<ImportType, { columns: string[]; required: string[]; example: string[] }> = {
  retailers: {
    columns: ["outlet_name", "phone", "shop_number", "complex_name", "pin_code", "region", "area", "sales_agent"],
    required: ["outlet_name", "phone", "pin_code", "region", "area"],
    example: ["Agarwal General Store", "9876543210", "G-12", "Shree Complex", "400058", "Mumbai", "Andheri", "Test agent"],
  },
  products: {
    columns: ["name", "sku", "category", "unit", "price", "mrp", "gst_rate", "special_offer"],
    required: ["name", "sku", "category", "unit", "price", "mrp"],
    example: ["Masala Chai 250g", "BEV-001", "Beverages", "pack", "85", "95", "5", ""],
  },
  balances: {
    // amount in rupees: positive = retailer owes you, negative = advance you hold
    columns: ["phone", "amount", "as_of", "note"],
    required: ["phone", "amount"],
    example: ["9876543210", "12500.50", "2026-03-31", "Balance from old books"],
  },
};

export function templateCsv(type: ImportType) {
  const t = TEMPLATES[type];
  return [t.columns.join(","), t.example.map(csvCell).join(",")].join("\r\n") + "\r\n";
}

function csvCell(v: string) {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** "Outlet Name " → "outlet_name" */
export function normaliseHeader(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/** RFC 4180-ish CSV parser (quotes, escaped quotes, CRLF, BOM). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function toRows(table: string[][]): Row[] {
  if (!table.length) return [];
  const headers = table[0].map(normaliseHeader);
  return table.slice(1).map((cells) => {
    const r: Row = {};
    headers.forEach((h, i) => {
      if (h) r[h] = (cells[i] ?? "").toString().trim();
    });
    return r;
  });
}

export async function parseSheet(bytes: Buffer, filename: string): Promise<Row[]> {
  if (/\.xlsx$/i.test(filename)) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const table: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) {
        const v = row.getCell(c).value;
        cells.push(
          v == null
            ? ""
            : typeof v === "object" && "text" in v
              ? String(v.text)
              : typeof v === "object" && "result" in v
                ? String(v.result ?? "")
                : String(v)
        );
      }
      table.push(cells);
    });
    return toRows(table);
  }
  return toRows(parseCsv(bytes.toString("utf8")));
}

/** "+91 98765-43210" → "9876543210" */
export function cleanPhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
}

export type RetailerRow = {
  row: number;
  outletName: string;
  phone: string;
  shopNumber: string;
  complexName: string;
  pinCode: string;
  region: string;
  area: string;
  salesAgent: string;
};

export type ProductRow = {
  row: number;
  name: string;
  sku: string;
  category: string;
  unit: string;
  price: number;
  mrp: number;
  gstRate: number;
  specialOffer: string | null;
};

const GST_RATES = new Set([0, 0.25, 3, 5, 12, 18, 28, 40]);

function missing(r: Row, required: string[]) {
  return required.filter((k) => !r[k]);
}

/** Row numbers are spreadsheet rows: header is row 1, first data row is 2. */
export function validateRetailers(rows: Row[]): { valid: RetailerRow[]; errors: RowError[] } {
  const valid: RetailerRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const miss = missing(r, TEMPLATES.retailers.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    const phone = cleanPhone(r.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return errors.push({ row, message: `Phone "${r.phone}" is not a 10-digit mobile number` });
    if (!/^\d{6}$/.test(r.pin_code)) return errors.push({ row, message: `PIN code "${r.pin_code}" must be 6 digits` });
    if (seen.has(phone)) return errors.push({ row, message: `Phone ${phone} is repeated (first on row ${seen.get(phone)})` });
    seen.set(phone, row);
    valid.push({
      row,
      outletName: r.outlet_name,
      phone,
      shopNumber: r.shop_number ?? "",
      complexName: r.complex_name ?? "",
      pinCode: r.pin_code,
      region: r.region,
      area: r.area,
      salesAgent: r.sales_agent ?? "",
    });
  });
  return { valid, errors };
}

export function validateProducts(rows: Row[]): { valid: ProductRow[]; errors: RowError[] } {
  const valid: ProductRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const miss = missing(r, TEMPLATES.products.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    let price: number, mrp: number;
    try {
      price = toPaise(r.price);
      mrp = toPaise(r.mrp);
    } catch {
      return errors.push({ row, message: "price and mrp must be numbers in rupees" });
    }
    if (price <= 0 || mrp <= 0) return errors.push({ row, message: "price and mrp must be more than 0" });
    if (price > mrp) return errors.push({ row, message: `price ₹${r.price} is above MRP ₹${r.mrp}` });
    const gstRate = r.gst_rate ? Number(r.gst_rate.replace("%", "")) : 0;
    if (!GST_RATES.has(gstRate)) return errors.push({ row, message: `GST rate "${r.gst_rate}" is not a valid GST slab` });
    const sku = r.sku;
    const skuKey = sku.toUpperCase();
    if (seen.has(skuKey)) return errors.push({ row, message: `SKU ${sku} is repeated (first on row ${seen.get(skuKey)})` });
    seen.set(skuKey, row);
    valid.push({
      row,
      name: r.name,
      sku,
      category: r.category,
      unit: r.unit,
      price,
      mrp,
      gstRate,
      specialOffer: r.special_offer || null,
    });
  });
  return { valid, errors };
}

export type BalanceRow = { row: number; phone: string; amount: number; asOf: Date; note: string };

/** "2026-03-31" or "31/03/2026" → IST midnight. */
export function parseIndianDate(raw: string): Date | null {
  const v = raw.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if ((mt = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v))) [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  const date = new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject 31/02 etc. (Date rolls them over).
  const back = new Date(date.getTime() + 5.5 * 3_600_000);
  if (back.getUTCDate() !== d || back.getUTCMonth() + 1 !== m) return null;
  return date;
}

export function validateBalances(rows: Row[], today = new Date()): { valid: BalanceRow[]; errors: RowError[] } {
  const valid: BalanceRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const miss = missing(r, TEMPLATES.balances.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    const phone = cleanPhone(r.phone);
    if (!/^[6-9]\d{9}$/.test(phone)) return errors.push({ row, message: `Phone "${r.phone}" is not a 10-digit mobile number` });
    if (seen.has(phone)) return errors.push({ row, message: `Phone ${phone} is repeated (first on row ${seen.get(phone)})` });
    let amount: number;
    try {
      amount = toPaise(r.amount);
    } catch {
      return errors.push({ row, message: `Amount "${r.amount}" is not a number` });
    }
    if (amount === 0) return errors.push({ row, message: "Amount is 0 (leave the row out)" });
    let asOf = today;
    if (r.as_of) {
      const d = parseIndianDate(r.as_of);
      if (!d) return errors.push({ row, message: `Date "${r.as_of}" should look like 2026-03-31 or 31/03/2026` });
      if (d > today) return errors.push({ row, message: "Date is in the future" });
      asOf = d;
    }
    seen.set(phone, row);
    valid.push({ row, phone, amount, asOf, note: (r.note ?? "").slice(0, 200) });
  });
  return { valid, errors };
}
