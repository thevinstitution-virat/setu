import { toPaise } from "@/lib/money";
import { parseDiscounts } from "@/lib/purchase-math";

/**
 * Bulk import of retailers and products from CSV or Excel (.xlsx).
 * Two steps: preview (validate every row, change nothing) → commit
 * (all rows in one transaction). Existing records are matched and updated:
 * retailers by phone, products by SKU.
 */

export type ImportType = "retailers" | "products" | "balances" | "prices" | "bills" | "bill_shares" | "suppliers" | "supplier_bills" | "purchases";
export const IMPORT_TYPES: ImportType[] = ["retailers", "products", "balances", "prices", "bills", "bill_shares", "suppliers", "supplier_bills", "purchases"];
/** Imports that write to the books (they also need purchases.manage). */
export const BOOKS_IMPORTS: ImportType[] = ["suppliers", "supplier_bills", "purchases"];
export type Row = Record<string, string>;
export type RowError = { row: number; message: string };

export const MAX_ROWS = 5000;

export const TEMPLATES: Record<ImportType, { columns: string[]; required: string[]; example: string[] }> = {
  retailers: {
    // phone is optional: a shop without one is matched by outlet_name + area. pin_code blank = the business's own PIN.
    columns: ["outlet_name", "phone", "shop_number", "complex_name", "pin_code", "region", "area", "sales_agent", "contact_name", "alt_phone"],
    required: ["outlet_name", "region", "area"],
    example: ["Agarwal General Store", "9876543210", "G-12", "Shree Complex", "400058", "Mumbai", "Andheri", "Test agent", "Ramesh", "02226345678"],
  },
  products: {
    // company = the principal company (supplier) the product comes from, for company-wise outstanding.
    columns: ["name", "sku", "category", "unit", "price", "mrp", "gst_rate", "special_offer", "brand", "hsn_code", "name_hi", "case_unit", "case_size", "moq", "company"],
    required: ["name", "sku", "category", "unit", "price", "mrp"],
    example: ["Masala Chai 250g", "BEV-001", "Beverages", "pack", "85", "95", "5", "", "Chaiwala", "0902", "मसाला चाय", "box", "24", "1", "Chaiwala Foods Pvt Ltd"],
  },
  balances: {
    // amount in rupees: positive = retailer owes you, negative = advance you hold
    columns: ["phone", "amount", "as_of", "note"],
    required: ["phone", "amount"],
    example: ["9876543210", "12500.50", "2026-03-31", "Balance from old books"],
  },
  prices: {
    // One of price_list (rate in that list; the list is created if new) or phone (a retailer's special rate).
    columns: ["price_list", "phone", "sku", "price"],
    required: ["sku", "price"],
    example: ["Wholesale", "", "BEV-001", "80"],
  },
  bills: {
    // Open bills from the old book (e.g. its "debtors outstanding" report), one row per bill.
    // The shop is found by phone, else by party (+ area when two shops share a name).
    // A row with no invoice_no and a negative bill_value is money the shop paid in advance.
    columns: ["party", "area", "phone", "invoice_no", "date", "bill_value", "received", "due_date", "salesman"],
    required: ["party", "bill_value"],
    example: ["Shree Ganesh Kirana", "Station Road", "9876543210", "A004231", "21/11/2026", "9520", "0", "21/11/2026", "Ravi Sales"],
  },
  bill_shares: {
    // How much of each open bill is each company's (the old book's company-wise outstanding),
    // one row per bill and company. Bills imported with "bills" only; the shares must add up to the bill.
    columns: ["invoice_no", "company", "value"],
    required: ["invoice_no", "company", "value"],
    example: ["A004231", "Chaiwala Foods Pvt Ltd", "6240.50"],
  },
  suppliers: {
    // Matched by name: a supplier already here is updated (blank cells leave a field as it is).
    // kind: goods (a company whose products we sell), services or other. PAN and state come from the GSTIN when blank.
    columns: ["name", "kind", "gstin", "pan", "state_code", "phone", "email", "contact_name", "address", "credit_days", "tds_section", "bank_name", "bank_ifsc", "bank_account_no"],
    required: ["name"],
    example: ["Chaiwala Foods Pvt Ltd", "goods", "", "AABCC1234D", "27", "9822012345", "accounts@example.com", "Mr Joshi", "MIDC, Pune", "30", "", "State Bank of India", "SBIN0001234", "12345678901"],
  },
  supplier_bills: {
    // What we owed each supplier on the switch date (the old software's creditors outstanding), one row per bill.
    // A row with no bill_no and a negative amount is an advance we had paid them. All of a supplier's bills go in together, once.
    columns: ["supplier", "bill_no", "date", "amount", "paid", "due_date"],
    required: ["supplier", "amount"],
    example: ["Chaiwala Foods Pvt Ltd", "CF/2526/0912", "18/03/2026", "48250", "10000", "17/04/2026"],
  },
  purchases: {
    // Purchase bills, one row per line; the rows of a bill share supplier + bill_no (and its date).
    // sku = one of our products; else head = an account head (rent, freight ...) by name.
    // gst_rate blank = the product's rate. bill_total = the total printed on the bill (rounding up to Rs 1).
    // mrp = MRP per unit (goods only). discount_pct can be 10+5 (up to three, each on what is left).
    // scheme_amount = the company's scheme discount on the line in Rs (after the % discounts, before GST).
    // deal = a free-goods deal like 10+1 (1 free for every 10 billed; by the case it counts cases); it works out free_qty.
    columns: ["supplier", "bill_no", "date", "due_date", "sku", "head", "item", "qty", "free_qty", "rate", "mrp", "discount_pct", "scheme_amount", "deal", "gst_rate", "rates_include_gst", "reverse_charge", "bill_total"],
    required: ["supplier", "bill_no", "date", "qty", "rate"],
    example: ["Chaiwala Foods Pvt Ltd", "CF/2627/0457", "21/11/2026", "", "BEV-001", "", "", "48", "", "70.50", "95", "3", "25", "24+1", "5", "no", "no", "3388"],
  },
};

/** Extra purchase bill columns when the business imports by the case (Settings → Stock). */
export const PURCHASE_CASE_COLUMNS = ["cases", "loose", "case_size", "case_rate"];

export function templateCsv(type: ImportType, opts: { purchaseCases?: boolean } = {}) {
  const t = TEMPLATES[type];
  if (type === "purchases" && opts.purchaseCases) {
    // Same as the plain sheet, with the case columns after rate, and a second line billed by the case.
    const at = t.columns.indexOf("rate") + 1;
    const cols = [...t.columns.slice(0, at), ...PURCHASE_CASE_COLUMNS, ...t.columns.slice(at)];
    const plain = [...t.example.slice(0, at), "", "", "", "", ...t.example.slice(at)];
    const byCase = ["Chaiwala Foods Pvt Ltd", "CF/2627/0457", "21/11/2026", "", "BEV-002", "", "", "", "", "", "10", "6", "24", "1680.50", "120", "10+5", "", "", "5", "no", "no", "3388"];
    return [cols.join(","), plain.map(csvCell).join(","), byCase.map(csvCell).join(",")].join("\r\n") + "\r\n";
  }
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

/**
 * Total unpacked size of a .zip (an .xlsx is one), from its central
 * directory; null when it isn't a readable zip. Checked before ExcelJS
 * unpacks it all in memory: a 5 MB file can unpack to gigabytes.
 */
export function zipUnpackedSize(b: Buffer): number | null {
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (b.readUInt32LE(i) !== 0x06054b50) continue;
    const count = b.readUInt16LE(i + 10);
    let off = b.readUInt32LE(i + 16);
    let total = 0;
    for (let n = 0; n < count; n++) {
      if (off + 46 > b.length || b.readUInt32LE(off) !== 0x02014b50) return null;
      total += b.readUInt32LE(off + 24);
      off += 46 + b.readUInt16LE(off + 28) + b.readUInt16LE(off + 30) + b.readUInt16LE(off + 32);
    }
    return total;
  }
  return null;
}

const MAX_UNPACKED = 60 * 1024 * 1024;
/** Columns read per row: our templates have fewer than 20. */
const MAX_COLUMNS = 60;

export async function parseSheet(bytes: Buffer, filename: string): Promise<Row[]> {
  if (/\.xlsx$/i.test(filename)) {
    const unpacked = zipUnpackedSize(bytes);
    if (unpacked === null || unpacked > MAX_UNPACKED) throw new Error("Not a readable .xlsx, or too large unpacked");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const table: string[][] = [];
    const cols = Math.min(ws.columnCount, MAX_COLUMNS);
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (table.length > MAX_ROWS + 1) return; // the route refuses more; don't build them
      const cells: string[] = [];
      for (let c = 1; c <= cols; c++) {
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
  /** null = no mobile number: the shop is matched by outlet name + area. */
  phone: string | null;
  shopNumber: string;
  complexName: string;
  /** "" = use the business's own PIN code. */
  pinCode: string;
  region: string;
  area: string;
  salesAgent: string;
  contactName: string | null;
  altPhone: string | null;
};

/** Key for a shop without a phone: outlet name + area, ignoring case and extra spaces. */
export const shopKey = (outletName: string, area: string) => `${outletName.trim().replace(/\s+/g, " ").toLowerCase()}|${area.trim().replace(/\s+/g, " ").toLowerCase()}`;

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
  brand: string | null;
  hsnCode: string | null;
  nameHi: string | null;
  caseUnit: string | null;
  caseSize: number | null;
  moq: number;
  /** Principal company (supplier) name; null = leave as it is. */
  company: string | null;
};

const GST_RATES = new Set([0, 0.25, 3, 5, 12, 18, 28, 40]);

/** "18", "18%", " 18 % " → 18. Every % and space goes, not just the first; NaN when nothing is left. */
export function parseGstRate(text: string): number {
  const clean = text.replace(/[%\s]/g, "");
  return clean ? Number(clean) : NaN;
}

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
    const phone = (r.phone ?? "").trim() ? cleanPhone(r.phone) : null;
    if (phone !== null && !/^[6-9]\d{9}$/.test(phone)) return errors.push({ row, message: `Phone "${r.phone}" is not a 10-digit mobile number` });
    const pin = (r.pin_code ?? "").trim();
    if (pin && !/^\d{6}$/.test(pin)) return errors.push({ row, message: `PIN code "${r.pin_code}" must be 6 digits` });
    const key = phone ?? shopKey(r.outlet_name, r.area);
    if (seen.has(key)) {
      return errors.push({ row, message: phone ? `Phone ${phone} is repeated (first on row ${seen.get(key)})` : `${r.outlet_name} in ${r.area} is repeated (first on row ${seen.get(key)})` });
    }
    seen.set(key, row);
    const alt = (r.alt_phone ?? "").replace(/[^\d+\-\s]/g, "").trim().slice(0, 20);
    valid.push({
      row,
      outletName: r.outlet_name.trim(),
      phone,
      shopNumber: r.shop_number ?? "",
      complexName: r.complex_name ?? "",
      pinCode: pin,
      region: r.region.trim(),
      area: r.area.trim(),
      salesAgent: r.sales_agent ?? "",
      contactName: (r.contact_name ?? "").trim().slice(0, 80) || null,
      altPhone: alt || null,
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
    const gstRate = r.gst_rate ? parseGstRate(r.gst_rate) : 0;
    if (!GST_RATES.has(gstRate)) return errors.push({ row, message: `GST rate "${r.gst_rate}" is not a valid GST slab` });
    const sku = r.sku;
    const skuKey = sku.toUpperCase();
    if (seen.has(skuKey)) return errors.push({ row, message: `SKU ${sku} is repeated (first on row ${seen.get(skuKey)})` });
    const hsn = (r.hsn_code ?? "").trim();
    if (hsn && !/^\d{4,8}$/.test(hsn)) return errors.push({ row, message: `HSN code "${hsn}" must be 4 to 8 digits` });
    const caseUnit = (r.case_unit ?? "").trim() || null;
    const caseSize = (r.case_size ?? "").trim() ? Number(r.case_size) : null;
    if ((caseUnit === null) !== (caseSize === null)) return errors.push({ row, message: "Give both case_unit and case_size, or neither" });
    if (caseSize !== null && (!Number.isInteger(caseSize) || caseSize < 2)) return errors.push({ row, message: "case_size must be a whole number of 2 or more" });
    const moq = (r.moq ?? "").trim() ? Number(r.moq) : 1;
    if (!Number.isInteger(moq) || moq < 1) return errors.push({ row, message: "moq must be a whole number of at least 1" });
    seen.set(skuKey, row);
    valid.push({
      row,
      brand: (r.brand ?? "").trim() || null,
    company: (r.company ?? "").trim().slice(0, 120) || null,
      hsnCode: hsn || null,
      nameHi: (r.name_hi ?? "").trim() || null,
      caseUnit,
      caseSize,
      moq,
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

export type BillRow = {
  row: number;
  party: string;
  area: string;
  phone: string | null;
  /** null with a negative amount = advance. */
  number: string | null;
  date: Date | null;
  dueDate: Date | null;
  /** Bill value, paise (negative = advance). */
  amount: number;
  /** Already received in the old book, paise. */
  paid: number;
  salesman: string;
};

/** Open bills from the old book, one row per bill (see TEMPLATES.bills). */
export function validateBills(rows: Row[], today = new Date()): { valid: BillRow[]; errors: RowError[] } {
  const valid: BillRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const miss = missing(r, TEMPLATES.bills.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    const phone = (r.phone ?? "").trim() ? cleanPhone(r.phone) : null;
    if (phone !== null && !/^[6-9]\d{9}$/.test(phone)) return errors.push({ row, message: `Phone "${r.phone}" is not a 10-digit mobile number` });
    let amount: number, paid: number;
    try {
      amount = toPaise(r.bill_value);
      paid = (r.received ?? "").trim() ? toPaise(r.received) : 0;
    } catch {
      return errors.push({ row, message: "bill_value and received must be numbers in rupees" });
    }
    const number = (r.invoice_no ?? "").trim().toUpperCase() || null;
    if (!number) {
      if (amount >= 0) return errors.push({ row, message: "Missing invoice_no (only an advance, a negative bill_value, may leave it blank)" });
      valid.push({ row, party: r.party.trim(), area: (r.area ?? "").trim(), phone, number: null, date: null, dueDate: null, amount, paid: 0, salesman: "" });
      return;
    }
    if (!/^[A-Z0-9/-]{1,16}$/.test(number)) return errors.push({ row, message: `Invoice number "${r.invoice_no}" may have only letters, digits, / and - (16 at most)` });
    if (seen.has(number)) return errors.push({ row, message: `Invoice ${number} is repeated (first on row ${seen.get(number)})` });
    if (amount <= 0) return errors.push({ row, message: "bill_value must be more than 0" });
    if (paid < 0) return errors.push({ row, message: "received can't be negative" });
    if (paid >= amount) return errors.push({ row, message: "received is the whole bill: it isn't outstanding (leave the row out)" });
    const date = parseIndianDate(r.date ?? "");
    if (!date) return errors.push({ row, message: `Date "${r.date ?? ""}" should look like 21/11/2026 or 2026-11-21` });
    if (date > today) return errors.push({ row, message: "Date is in the future" });
    let dueDate: Date | null = null;
    if ((r.due_date ?? "").trim()) {
      dueDate = parseIndianDate(r.due_date);
      if (!dueDate) return errors.push({ row, message: `Due date "${r.due_date}" should look like 21/11/2026 or 2026-11-21` });
      if (dueDate < date) return errors.push({ row, message: "Due date is before the bill date" });
    }
    seen.set(number, row);
    valid.push({ row, party: r.party.trim(), area: (r.area ?? "").trim(), phone, number, date, dueDate, amount, paid, salesman: (r.salesman ?? "").trim() });
  });
  return { valid, errors };
}

export type PriceRow = { row: number; priceList: string | null; phone: string | null; sku: string; price: number };

export function validatePrices(rows: Row[]): { valid: PriceRow[]; errors: RowError[] } {
  const valid: PriceRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const miss = missing(r, TEMPLATES.prices.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    const list = (r.price_list ?? "").trim() || null;
    const phone = (r.phone ?? "").trim() ? cleanPhone(r.phone) : null;
    if ((list === null) === (phone === null)) return errors.push({ row, message: "Fill either price_list or phone (not both)" });
    if (phone && !/^[6-9]\d{9}$/.test(phone)) return errors.push({ row, message: `Phone "${r.phone}" is not a 10-digit mobile number` });
    let price: number;
    try {
      price = toPaise(r.price);
    } catch {
      return errors.push({ row, message: "price must be a number in rupees" });
    }
    if (price < 0) return errors.push({ row, message: "price can't be negative" });
    const key = `${list ? `L:${list.toUpperCase()}` : `P:${phone}`}|${r.sku.toUpperCase()}`;
    if (seen.has(key)) return errors.push({ row, message: `Repeated (first on row ${seen.get(key)})` });
    seen.set(key, row);
    valid.push({ row, priceList: list, phone, sku: r.sku.trim(), price });
  });
  return { valid, errors };
}

export type BillShareRow = { row: number; number: string; company: string; amount: number };

/** A bill's value by company, one row per bill and company (see TEMPLATES.bill_shares). */
export function validateBillShares(rows: Row[]): { valid: BillShareRow[]; errors: RowError[] } {
  const valid: BillShareRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const miss = missing(r, TEMPLATES.bill_shares.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    const number = r.invoice_no.trim().toUpperCase();
    const company = r.company.trim().replace(/\s+/g, " ").slice(0, 120);
    let amount: number;
    try {
      amount = toPaise(r.value);
    } catch {
      return errors.push({ row, message: "value must be a number in rupees" });
    }
    if (amount <= 0) return errors.push({ row, message: "value must be more than 0" });
    const key = `${number}|${company.toLowerCase()}`;
    if (seen.has(key)) return errors.push({ row, message: `${company} is on bill ${number} twice (first on row ${seen.get(key)})` });
    seen.set(key, row);
    valid.push({ row, number, company, amount });
  });
  return { valid, errors };
}

// ───────────────────────────── A2.6 books imports ─────────────────────────────

/** Excel's dates arrive as "2026-03-18"; a person's as 18/03/2026. → "YYYY-MM-DD" (IST). */
export function importDay(raw: string): string | null {
  const d = parseIndianDate(raw ?? "");
  return d ? new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10) : null;
}
const istToday = (today: Date) => new Date(today.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const yes = (v: string | undefined) => /^(y|yes|true|1|haan|ha)$/i.test((v ?? "").trim());

export type SupplierImportRow = { row: number; name: string; fields: Record<string, unknown> };

/** Suppliers: the cells sent (blank = leave as it is), checked again by the supplier rules when saved. */
export function validateSuppliers(rows: Row[]): { valid: SupplierImportRow[]; errors: RowError[] } {
  const valid: SupplierImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  const map: Record<string, string> = {
    kind: "kind",
    gstin: "gstin",
    pan: "pan",
    state_code: "stateCode",
    phone: "phone",
    email: "email",
    contact_name: "contactName",
    address: "address",
    credit_days: "creditDays",
    tds_section: "tdsSection",
    bank_name: "bankName",
    bank_ifsc: "bankIfsc",
    bank_account_no: "bankAccountNo",
  };
  rows.forEach((r, i) => {
    const row = i + 2;
    const name = (r.name ?? "").trim().replace(/\s+/g, " ");
    if (name.length < 2) return errors.push({ row, message: "Missing name" });
    const k = name.toLowerCase();
    if (seen.has(k)) return errors.push({ row, message: `${name} is repeated (first on row ${seen.get(k)})` });
    seen.set(k, row);
    const fields: Record<string, unknown> = {};
    for (const [col, key] of Object.entries(map)) {
      const v = (r[col] ?? "").trim();
      if (!v) continue;
      fields[key] = key === "creditDays" ? Number(v) : key === "kind" ? v.toUpperCase() : v;
    }
    if (fields.stateCode && /^\d$/.test(String(fields.stateCode))) fields.stateCode = `0${fields.stateCode}`;
    valid.push({ row, name, fields });
  });
  return { valid, errors };
}

export type SupplierBillImportRow = { row: number; supplier: string; number: string | null; date: string | null; dueDate: string | null; amount: number; paid: number };

/** Suppliers' open bills on the switch date (see TEMPLATES.supplier_bills). */
export function validateSupplierBills(rows: Row[], today = new Date()): { valid: SupplierBillImportRow[]; errors: RowError[] } {
  const valid: SupplierBillImportRow[] = [];
  const errors: RowError[] = [];
  const seen = new Map<string, number>();
  const now = istToday(today);
  rows.forEach((r, i) => {
    const row = i + 2;
    const miss = missing(r, TEMPLATES.supplier_bills.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    const supplier = r.supplier.trim().replace(/\s+/g, " ");
    let amount: number, paid: number;
    try {
      amount = toPaise(r.amount);
      paid = (r.paid ?? "").trim() ? toPaise(r.paid) : 0;
    } catch {
      return errors.push({ row, message: "amount and paid must be numbers in rupees" });
    }
    const number = (r.bill_no ?? "").trim() || null;
    if (!number) {
      if (amount >= 0) return errors.push({ row, message: "Missing bill_no (only an advance, a negative amount, may leave it blank)" });
      valid.push({ row, supplier, number: null, date: null, dueDate: null, amount, paid: 0 });
      return;
    }
    if (number.length > 40) return errors.push({ row, message: "bill_no is longer than 40 characters" });
    const key = `${supplier.toLowerCase()}|${number.toLowerCase()}`;
    if (seen.has(key)) return errors.push({ row, message: `Bill ${number} of ${supplier} is repeated (first on row ${seen.get(key)})` });
    if (amount <= 0) return errors.push({ row, message: "amount must be more than 0" });
    if (paid < 0) return errors.push({ row, message: "paid can't be negative" });
    if (paid >= amount) return errors.push({ row, message: "paid is the whole bill: it isn't outstanding (leave the row out)" });
    const date = importDay(r.date ?? "");
    if (!date) return errors.push({ row, message: `Date "${r.date ?? ""}" should look like 21/11/2026 or 2026-11-21` });
    if (date > now) return errors.push({ row, message: "Date is in the future" });
    let dueDate: string | null = null;
    if ((r.due_date ?? "").trim()) {
      dueDate = importDay(r.due_date);
      if (!dueDate) return errors.push({ row, message: `Due date "${r.due_date}" should look like 21/11/2026 or 2026-11-21` });
      if (dueDate < date) return errors.push({ row, message: "Due date is before the bill date" });
    }
    seen.set(key, row);
    valid.push({ row, supplier, number, date, dueDate, amount, paid });
  });
  return { valid, errors };
}

export type PurchaseImportLine = {
  row: number;
  sku: string | null;
  head: string | null;
  item: string | null;
  quantity: number;
  freeQty: number;
  rate: number;
  discountPct: number;
  /** Further discounts, each on what is left after the one before ("10+5" → 10, then 5). */
  discount2Pct: number;
  discount3Pct: number;
  /** MRP per unit, paise (goods only). */
  mrp: number | null;
  /** The company's scheme discount on the line, paise. */
  schemeAmount: number;
  /** Free-goods deal: `get` free for every `buy` billed (cases on a line billed by the case). */
  deal?: { buy: number; get: number };
  gstRate: number | null;
  /** By the case: whole cases + loose units at caseRate (paise); caseSize null = the product's. quantity 0 = work it out. */
  byCase?: { cases: number; loose: number; caseSize: number | null; caseRate: number };
};
export type PurchaseImportBill = {
  rows: number[];
  supplier: string;
  number: string;
  date: string;
  dueDate: string | null;
  ratesIncludeGst: boolean;
  reverseCharge: boolean;
  billTotal: number | null;
  lines: PurchaseImportLine[];
};

const num = (v: string | undefined) => {
  const t = (v ?? "").trim().replace(/,/g, "");
  return t ? Number(t) : 0;
};

/** Purchase bills, one row per line, grouped by supplier + bill_no (see TEMPLATES.purchases). */
export function validatePurchases(rows: Row[], today = new Date(), opts: { purchaseCases?: boolean } = {}): { valid: PurchaseImportBill[]; errors: RowError[] } {
  const errors: RowError[] = [];
  const bills = new Map<string, PurchaseImportBill>();
  const now = istToday(today);
  rows.forEach((r, i) => {
    const row = i + 2;
    const caseCells = PURCHASE_CASE_COLUMNS.filter((c) => (r[c] ?? "").trim());
    if (caseCells.length && !opts.purchaseCases) {
      return errors.push({ row, message: `This sheet fills ${caseCells.join(", ")}: the owner can turn on "Purchase bill sheets by the case" in Settings → Stock, or enter qty and rate instead` });
    }
    const caseLine = caseCells.length > 0;
    const miss = missing(r, caseLine ? TEMPLATES.purchases.required.filter((c) => c !== "qty" && c !== "rate") : TEMPLATES.purchases.required);
    if (miss.length) return errors.push({ row, message: `Missing ${miss.join(", ")}` });
    const supplier = r.supplier.trim().replace(/\s+/g, " ");
    const number = r.bill_no.trim();
    if (number.length > 40) return errors.push({ row, message: "bill_no is longer than 40 characters" });
    const date = importDay(r.date);
    if (!date) return errors.push({ row, message: `Date "${r.date}" should look like 21/11/2026 or 2026-11-21` });
    if (date > now) return errors.push({ row, message: "Date is in the future" });
    const dueDate = (r.due_date ?? "").trim() ? importDay(r.due_date) : null;
    if ((r.due_date ?? "").trim() && !dueDate) return errors.push({ row, message: `Due date "${r.due_date}" should look like 21/11/2026 or 2026-11-21` });
    const sku = (r.sku ?? "").trim() || null;
    const head = (r.head ?? "").trim() || null;
    if (!sku && !head) return errors.push({ row, message: "Give the sku of one of our products, or the account head (like Rent or Freight)" });
    if (!sku && (r.mrp ?? "").trim()) return errors.push({ row, message: "mrp goes only on a product (sku) line" });
    if (!sku && ((r.scheme_amount ?? "").trim() || (r.deal ?? "").trim())) return errors.push({ row, message: "scheme_amount and deal go only on a product (sku) line" });
    let schemeAmount = 0;
    if ((r.scheme_amount ?? "").trim()) {
      try {
        schemeAmount = toPaise(r.scheme_amount);
      } catch {
        return errors.push({ row, message: "scheme_amount must be a number in rupees" });
      }
      if (schemeAmount < 0) return errors.push({ row, message: "scheme_amount can't be below 0" });
    }
    let deal: PurchaseImportLine["deal"];
    const dealText = (r.deal ?? "").trim();
    if (dealText) {
      const dm = /^(\d+)\s*\+\s*(\d+)$/.exec(dealText);
      if (!dm || Number(dm[1]) < 1 || Number(dm[2]) < 1) return errors.push({ row, message: `deal "${dealText}" should look like 10+1 (1 free for every 10)` });
      deal = { buy: Number(dm[1]), get: Number(dm[2]) };
    }
    const quantity = num(r.qty);
    const freeQty = num(r.free_qty);
    const discounts = parseDiscounts((r.discount_pct ?? "").trim());
    if (!discounts || discounts.some((d) => d >= 100)) return errors.push({ row, message: `discount_pct "${r.discount_pct}" should look like 3, or 10+5 for one discount after another (up to three, each under 100)` });
    const [discountPct = 0, discount2Pct = 0, discount3Pct = 0] = discounts;
    let mrp: number | null = null;
    if ((r.mrp ?? "").trim()) {
      try {
        mrp = toPaise(r.mrp);
      } catch {
        return errors.push({ row, message: "mrp must be a number in rupees" });
      }
      if (mrp < 0) return errors.push({ row, message: "mrp can't be below 0" });
    }
    const gstText = (r.gst_rate ?? "").trim().replace(/%$/, "");
    const gstRate = gstText ? Number(gstText) : null;
    let byCase: PurchaseImportLine["byCase"];
    if (caseLine) {
      if (!sku) return errors.push({ row, message: "Only a product (sku) can be billed by the case" });
      const cases = num(r.cases);
      const loose = num(r.loose);
      const size = (r.case_size ?? "").trim() ? num(r.case_size) : null;
      let caseRate: number;
      try {
        caseRate = toPaise(r.case_rate);
      } catch {
        return errors.push({ row, message: "case_rate (the rate per case) must be a number in rupees" });
      }
      if (!(r.case_rate ?? "").trim() || caseRate <= 0) return errors.push({ row, message: "Give case_rate, the rate per case in rupees" });
      if (!Number.isInteger(cases) || cases < 0 || !Number.isInteger(loose) || loose < 0) return errors.push({ row, message: "cases and loose must be whole numbers" });
      if (size !== null && (!Number.isInteger(size) || size < 1 || size > 100_000)) return errors.push({ row, message: "case_size must be a whole number, 1 or more" });
      if (cases + loose === 0) return errors.push({ row, message: "Give the cases (or loose units)" });
      if (size !== null && quantity && quantity !== cases * size + loose) return errors.push({ row, message: `qty ${quantity} isn't ${cases} × ${size} + ${loose}: leave qty blank or fix it` });
      byCase = { cases, loose, caseSize: size, caseRate };
    }
    let rate = 0;
    if (!caseLine) {
      try {
        rate = toPaise(r.rate);
      } catch {
        return errors.push({ row, message: "rate must be a number in rupees" });
      }
      if (!Number.isInteger(quantity) || quantity <= 0) return errors.push({ row, message: "qty must be a whole number more than 0" });
    } else if (!Number.isInteger(quantity) || quantity < 0) return errors.push({ row, message: "qty must be a whole number" });
    if (!Number.isInteger(freeQty) || freeQty < 0) return errors.push({ row, message: "free_qty must be a whole number" });
    if (gstRate !== null && !Number.isFinite(gstRate)) return errors.push({ row, message: "gst_rate must be a number, like 5 or 18" });
    if (!caseLine && rate <= 0) return errors.push({ row, message: "rate must be more than 0" });
    let billTotal: number | null = null;
    if ((r.bill_total ?? "").trim()) {
      try {
        billTotal = toPaise(r.bill_total);
      } catch {
        return errors.push({ row, message: "bill_total must be a number in rupees" });
      }
    }
    const key = `${supplier.toLowerCase()}|${number.toLowerCase()}`;
    let b = bills.get(key);
    if (!b) {
      b = { rows: [], supplier, number, date, dueDate, ratesIncludeGst: yes(r.rates_include_gst), reverseCharge: yes(r.reverse_charge), billTotal, lines: [] };
      bills.set(key, b);
    } else if (b.date !== date) return errors.push({ row, message: `Bill ${number} has another date on row ${b.rows[0]}` });
    else if (billTotal !== null && b.billTotal !== null && billTotal !== b.billTotal) return errors.push({ row, message: `Bill ${number} has another bill_total on row ${b.rows[0]}` });
    if (b.billTotal === null && billTotal !== null) b.billTotal = billTotal;
    if (!b.dueDate && dueDate) b.dueDate = dueDate;
    b.rows.push(row);
    b.lines.push({ row, sku, head, item: (r.item ?? "").trim() || null, quantity, freeQty, rate, discountPct, discount2Pct, discount3Pct, mrp, schemeAmount, gstRate, ...(byCase ? { byCase } : {}), ...(deal ? { deal } : {}) });
  });
  // A bill with a bad row is left out whole, so it isn't entered half.
  const bad = new Set(errors.map((e) => e.row));
  const badBills = new Map<string, number>();
  for (const e of errors) {
    const r = rows[e.row - 2];
    if (!r) continue;
    const key = `${(r.supplier ?? "").trim().replace(/\s+/g, " ").toLowerCase()}|${(r.bill_no ?? "").trim().toLowerCase()}`;
    if (!badBills.has(key)) badBills.set(key, e.row);
  }
  const valid: PurchaseImportBill[] = [];
  for (const [key, b] of bills) {
    const hit = badBills.get(key);
    if (hit) {
      for (const x of b.rows) if (!bad.has(x)) errors.push({ row: x, message: `Bill ${b.number} has a problem on row ${hit}` });
      continue;
    }
    if (b.lines.length > 300) {
      for (const x of b.rows) errors.push({ row: x, message: `Bill ${b.number} has more than 300 lines` });
      continue;
    }
    valid.push(b);
  }
  errors.sort((a, c) => a.row - c.row);
  return { valid, errors };
}
