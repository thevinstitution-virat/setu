/**
 * GST helpers (pure, unit tested): state codes, GSTIN check, tax split,
 * financial year in Indian time, document numbers, units (UQC), amount in words.
 */

export const STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

export const isStateCode = (c: unknown): c is string => typeof c === "string" && c in STATES;

/** "27-Maharashtra", the place-of-supply format GSTR-1 uses. */
export const stateLabel = (code: string | null | undefined) => (code && STATES[code] ? `${code}-${STATES[code]}` : "");

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/;

/** GSTIN shape + state code + check digit. */
export function validGstin(g: string): boolean {
  if (!GSTIN_RE.test(g) || !isStateCode(g.slice(0, 2))) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(g[i]) * ((i % 2) + 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === g[14];
}

/** The check digit a 14-character GSTIN prefix needs (for test data). */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const p = GSTIN_CHARS.indexOf(first14[i]) * ((i % 2) + 1);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export const normaliseGstin = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : "");

/**
 * Split one line's GST. Inter-state = IGST; intra-state = CGST + SGST, half
 * each (an odd paisa goes to CGST) so the parts always add up to the total.
 */
export function splitTax(tax: number, interState: boolean) {
  if (interState) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.ceil(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}

const IST_MS = 330 * 60 * 1000;

/** Calendar parts of a moment in Indian time. */
export function istParts(d: Date) {
  const t = new Date(d.getTime() + IST_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** Financial year start (April) in Indian time: 19 Nov 2026 → 2026, 15 Mar 2027 → 2026. */
export function fyStartYear(d: Date) {
  const { y, m } = istParts(d);
  return m >= 4 ? y : y - 1;
}

/** "2627" for FY 2026-27 (document numbers). */
export function fyCode(d: Date) {
  const y = fyStartYear(d);
  return `${String(y % 100).padStart(2, "0")}${String((y + 1) % 100).padStart(2, "0")}`;
}

/** "2026-27" (e-invoice IRN hash, reports). */
export function fyName(d: Date) {
  const y = fyStartYear(d);
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}

/**
 * Last day a credit note for an invoice may be issued: 30 November after the
 * end of the invoice's financial year (end of that day, Indian time).
 */
export function creditNoteDeadline(invoiceDate: Date): Date {
  const y = fyStartYear(invoiceDate) + 1;
  return new Date(Date.UTC(y, 10, 30, 23, 59, 59) - IST_MS);
}

/** IST calendar date as YYYY-MM-DD. */
export function istDate(d: Date) {
  const { y, m, day } = istParts(d);
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** dd/mm/yyyy (e-invoice). */
export function ddmmyyyy(d: Date) {
  const { y, m, day } = istParts(d);
  return `${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** dd-MMM-yyyy (GSTR-1 offline tool). */
export function ddMonyyyy(d: Date) {
  const { y, m, day } = istParts(d);
  return `${String(day).padStart(2, "0")}-${MON[m - 1]}-${y}`;
}

/** Start of an IST day as a UTC instant (for date-range filters). */
export function istDayStart(ymd: string) {
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() - IST_MS);
}

/**
 * GST document numbers: at most 16 characters, letters, digits, "/" and "-",
 * unique per financial year. Format <prefix><fy>-<seq>, e.g. INV2627-00042.
 */
export function docNumber(prefix: string, fy: string, seq: number) {
  const n = `${prefix}${fy}-${String(seq).padStart(5, "0")}`;
  if (n.length > 16) throw new Error(`Document number ${n} is longer than 16 characters`);
  return n;
}

/**
 * A running series that keeps counting across financial years: <prefix><seq>
 * padded to `digits`, e.g. A004262 (still unique within every year, as GST needs).
 */
export function runningNumber(prefix: string, seq: number, digits: number) {
  const n = `${prefix}${String(seq).padStart(digits, "0")}`;
  if (n.length > 16) throw new Error(`Document number ${n} is longer than 16 characters`);
  return n;
}

export const PREFIX_RE = /^[A-Z][A-Z0-9/]{0,4}$/;

/** Unit name → GST Unique Quantity Code. */
export function uqc(unit: string | null | undefined): string {
  const u = (unit ?? "").toLowerCase().trim();
  const table: [RegExp, string][] = [
    [/^(pc|pcs|piece|pieces|nos?|no\.?|unit|units)$/, "PCS"],
    [/^(kg|kgs|kilo|kilogram)s?$/, "KGS"],
    [/^(g|gm|gms|gram|grams)$/, "GMS"],
    [/^(l|ltr|ltrs|litre|liter|litres|liters)$/, "LTR"],
    [/^(ml|mls|millilitre|milliliter)s?$/, "MLT"],
    [/^(box|boxes)$/, "BOX"],
    [/^(pack|packs|pkt|pkts|packet|packets|pouch|pouches)$/, "PAC"],
    [/^(bottle|bottles|btl|btls)$/, "BTL"],
    [/^(bag|bags|sack|sacks)$/, "BAG"],
    [/^(dozen|doz)$/, "DOZ"],
    [/^(can|cans|tin|tins)$/, "CAN"],
    [/^(carton|cartons|case|cases|ctn|peti)$/, "CTN"],
    [/^(set|sets)$/, "SET"],
    [/^(roll|rolls)$/, "ROL"],
    [/^(tube|tubes)$/, "TUB"],
    [/^(bundle|bundles)$/, "BUN"],
    [/^(pair|pairs)$/, "PRS"],
  ];
  return table.find(([re]) => re.test(u))?.[1] ?? "OTH";
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function upTo99(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}
function upTo999(n: number) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? upTo99(r) : ""].filter(Boolean).join(" ");
}

/** Whole number in Indian words (lakh, crore). */
export function numberInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  n %= 1_00_000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  if (lakh) parts.push(`${upTo99(lakh)} Lakh`);
  if (thousand) parts.push(`${upTo99(thousand)} Thousand`);
  if (n) parts.push(upTo999(n));
  return parts.join(" ");
}

/** ₹2,049.30 → "Rupees Two Thousand Forty Nine and Thirty Paise Only". */
export function amountInWords(paise: number): string {
  const r = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  return `Rupees ${numberInWords(r)}${p ? ` and ${upTo99(p)} Paise` : ""} Only`;
}

/** Paise → rupees with 2 decimals as a number (e-invoice, Excel). */
export const rupees = (paise: number) => Math.round(paise) / 100;
