/**
 * TDS maths that the browser can use too (A9): sections, rates, the limits
 * that decide whether TDS is due, quarters and due dates. No database here.
 *
 * Rates are in hundredths of a per cent (1% = 100, 0.1% = 10). Amounts are paise.
 */

export type TdsSectionRow = {
  code: string;
  name: string;
  rateInd: number;
  rateOther: number;
  rateNoPan: number;
  single: number | null;
  yearly: number | null;
  overOnly: boolean;
  active?: boolean;
  note?: string | null;
};

/** Starter sections (rates as of FY 2025-26). The owner or the CA should check them; they can be changed. */
export const STARTER_TDS_SECTIONS: TdsSectionRow[] = [
  { code: "194C", name: "Contractors: transport, loading, repairs, printing", rateInd: 100, rateOther: 200, rateNoPan: 2000, single: 30_000_00, yearly: 1_00_000_00, overOnly: false, note: "1% to an individual or HUF, 2% to others. Due above ₹30,000 at a time or ₹1,00,000 in the year." },
  { code: "194H", name: "Commission and brokerage", rateInd: 200, rateOther: 200, rateNoPan: 2000, single: null, yearly: 20_000_00, overOnly: false, note: "Due above ₹20,000 in the year." },
  { code: "194I(A)", name: "Rent of plant, machinery, equipment", rateInd: 200, rateOther: 200, rateNoPan: 2000, single: 50_000_00, yearly: null, overOnly: false, note: "Due when the rent is above ₹50,000 for a month." },
  { code: "194I(B)", name: "Rent of land, building, furniture", rateInd: 1000, rateOther: 1000, rateNoPan: 2000, single: 50_000_00, yearly: null, overOnly: false, note: "Due when the rent is above ₹50,000 for a month." },
  { code: "194J(A)", name: "Technical services", rateInd: 200, rateOther: 200, rateNoPan: 2000, single: null, yearly: 50_000_00, overOnly: false, note: "Due above ₹50,000 in the year." },
  { code: "194J(B)", name: "Professional fees: CA, lawyer, consultant", rateInd: 1000, rateOther: 1000, rateNoPan: 2000, single: null, yearly: 50_000_00, overOnly: false, note: "Due above ₹50,000 in the year." },
  { code: "194Q", name: "Purchase of goods", rateInd: 10, rateOther: 10, rateNoPan: 500, single: null, yearly: 50_00_000_00, overOnly: true, note: "Only if our sales last year were above ₹10 crore: 0.1% of purchases from one seller above ₹50 lakh in the year." },
];

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const isPan = (v: unknown): v is string => typeof v === "string" && PAN_RE.test(v);
/** Individuals and HUFs (4th letter P or H) get the lower rate where a section has two. */
export const panKind = (pan: string | null | undefined): "IND" | "OTHER" | "NONE" => (isPan(pan) ? ("PH".includes(pan[3]) ? "IND" : "OTHER") : "NONE");

export function rateFor(s: Pick<TdsSectionRow, "rateInd" | "rateOther" | "rateNoPan">, pan: string | null | undefined) {
  const k = panKind(pan);
  return k === "IND" ? s.rateInd : k === "OTHER" ? s.rateOther : s.rateNoPan;
}

/** "1%", "0.1%", "10%". */
export const rateLabel = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** TDS on an amount, rounded to the rupee (section 288B). */
export const tdsOn = (base: number, bp: number) => (base > 0 && bp > 0 ? Math.round((base * bp) / 10_000 / 100) * 100 : 0);

const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export type Proposal = { rate: number; tds: number; taxable: number; why: string };

/**
 * What the TDS should be on `base`, given the year so far with this party
 * under this section: `before` = amounts already billed / paid this year,
 * `deducted` = TDS already kept back from them this year.
 * Once the year's total crosses the limit, TDS is also due on the earlier
 * amounts (except 194Q, which only taxes the part above the limit).
 */
export function propose(s: TdsSectionRow, pan: string | null | undefined, base: number, before: number, deducted: number): Proposal {
  const rate = rateFor(s, pan);
  const noPan = panKind(pan) === "NONE" ? " (no PAN: the higher rate)" : "";
  if (s.active === false) return { rate, tds: 0, taxable: 0, why: `${s.code} is switched off` };
  if (base <= 0) return { rate, tds: 0, taxable: 0, why: "Nothing to deduct on" };
  const year = before + base;
  if (s.overOnly) {
    const over = s.yearly === null ? base : Math.max(0, Math.min(base, year - s.yearly));
    if (!over) return { rate, tds: 0, taxable: 0, why: `This year ${inr(year)} with this party, within the ${inr(s.yearly ?? 0)} limit` };
    return { rate, tds: tdsOn(over, rate), taxable: over, why: `${rateLabel(rate)} on ${inr(over)}, the part of this year's ${inr(year)} above ${inr(s.yearly ?? 0)}${noPan}` };
  }
  const bySingle = s.single !== null && base > s.single;
  const byYear = s.yearly !== null && year > s.yearly;
  if (!bySingle && !byYear) {
    const parts = [s.single !== null ? `this one ${inr(base)} of ${inr(s.single)}` : null, s.yearly !== null ? `this year ${inr(year)} of ${inr(s.yearly)}` : null].filter(Boolean);
    return { rate, tds: 0, taxable: 0, why: `Within the limits: ${parts.join("; ")}` };
  }
  // Crossing the yearly limit: TDS on the whole year, less what was already kept back.
  const catchUp = byYear ? Math.max(0, tdsOn(before, rate) - deducted) : 0;
  const tds = tdsOn(base, rate) + catchUp;
  const why = byYear
    ? `${rateLabel(rate)} on ${inr(base)}${catchUp ? ` plus ${inr(catchUp)} on the year's earlier ${inr(before)} (the year is now ${inr(year)}, over ${inr(s.yearly!)})` : ` (the year is ${inr(year)}, over ${inr(s.yearly!)})`}${noPan}`
    : `${rateLabel(rate)} on ${inr(base)} (above ${inr(s.single!)} at a time)${noPan}`;
  return { rate, tds, taxable: catchUp ? base + before : base, why };
}

// ───────────────────────────── periods ─────────────────────────────

/** Financial year of a day: 2026-11-25 → 2026 (FY 2026-27). */
export const fyOf = (day: string) => (Number(day.slice(5, 7)) >= 4 ? Number(day.slice(0, 4)) : Number(day.slice(0, 4)) - 1);
export const fyLabel = (fy: number) => `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
export const fyFrom = (fy: number) => `${fy}-04-01`;
export const fyTo = (fy: number) => `${fy + 1}-03-31`;
/** Quarter 1–4 of the financial year (Apr–Jun = 1). */
export const quarterOf = (day: string) => Math.floor(((Number(day.slice(5, 7)) + 8) % 12) / 3) + 1;
export const quarterRange = (fy: number, q: number) => {
  const m = 4 + (q - 1) * 3;
  const y = m > 12 ? fy + 1 : fy;
  const mm = ((m - 1) % 12) + 1;
  const endM = mm + 2;
  const last = new Date(Date.UTC(y, endM, 0)).getUTCDate();
  return { from: `${y}-${String(mm).padStart(2, "0")}-01`, to: `${y}-${String(endM).padStart(2, "0")}-${last}` };
};
export const quarterLabel = (fy: number, q: number) => `Q${q} ${fyLabel(fy)} (${["Apr–Jun", "Jul–Sep", "Oct–Dec", "Jan–Mar"][q - 1]})`;
/** Quarterly return (26Q / 27Q) due date. */
export const returnDue = (fy: number, q: number) => [`${fy}-07-31`, `${fy}-10-31`, `${fy + 1}-01-31`, `${fy + 1}-05-31`][q - 1];

/** TDS deducted in month "YYYY-MM" is due by the 7th of the next month; March's by 30 April. */
export function challanDue(period: string) {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  if (m === 3) return `${y}-04-30`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-07`;
}

/** Months for interest: from the month of deduction to the month of payment, both counted (a part month is a month). */
export const interestMonths = (deducted: string, paid: string) =>
  Math.max(0, (Number(paid.slice(0, 4)) - Number(deducted.slice(0, 4))) * 12 + Number(paid.slice(5, 7)) - Number(deducted.slice(5, 7)) + 1);

/** Interest for paying TDS late (section 201(1A)): 1.5% a month, rounded to the rupee. */
export const lateInterest = (tds: number, months: number) => (tds > 0 && months > 0 ? Math.round((tds * 0.015 * months) / 100) * 100 : 0);

/** "194J(b)" → "194J(B)"; checks the shape. */
export function cleanSection(v: unknown) {
  const x = typeof v === "string" ? v.trim().toUpperCase().replace(/\s/g, "") : "";
  return /^19\d[A-Z]{0,2}(\([A-Z]\))?$/.test(x) || /^206C[A-Z(),0-9]*$/.test(x) ? x : null;
}
