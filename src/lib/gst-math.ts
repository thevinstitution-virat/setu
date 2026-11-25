/**
 * GST return maths that needs no database (safe in the browser): months,
 * the set-off of input credit against output tax in the legal order, and
 * how supplier document numbers are compared.
 */

export type Heads = { igst: number; cgst: number; sgst: number };
export const HEADS = ["igst", "cgst", "sgst"] as const;
export type Head = (typeof HEADS)[number];
export const HEAD_LABEL: Record<Head, string> = { igst: "IGST", cgst: "CGST", sgst: "SGST" };

export const noHeads = (): Heads => ({ igst: 0, cgst: 0, sgst: 0 });
export const addHeads = (a: Heads, b: Heads, k = 1): Heads => ({ igst: a.igst + k * b.igst, cgst: a.cgst + k * b.cgst, sgst: a.sgst + k * b.sgst });
export const headsTotal = (h: Heads) => h.igst + h.cgst + h.sgst;

/**
 * CGST and SGST halves of a tax, or all IGST. The odd paisa goes to CGST, as
 * on invoices and purchase bills (gst.ts splitTax); a negative tax mirrors a
 * positive one.
 */
export function splitHeads(tax: number, interState: boolean): Heads {
  if (interState) return { igst: tax, cgst: 0, sgst: 0 };
  const cgst = tax >= 0 ? Math.ceil(tax / 2) : -Math.ceil(-tax / 2);
  return { igst: 0, cgst, sgst: tax - cgst };
}

// ───────────────────────────── months ─────────────────────────────

export const isPeriod = (p: unknown): p is string => typeof p === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);

/** First and last day of a month ("2026-10" → 2026-10-01 … 2026-10-31). */
export function periodRange(p: string) {
  const [y, m] = p.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${p}-01`, to: `${p}-${String(last).padStart(2, "0")}` };
}

export function shiftPeriod(p: string, n: number) {
  const [y, m] = p.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const periodOf = (day: string) => day.slice(0, 7);

export function periodLabel(p: string) {
  return new Date(`${p}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The return period on the portal ("102026" for October 2026). */
export const portalPeriod = (p: string) => `${p.slice(5, 7)}${p.slice(0, 4)}`;

// ───────────────────────────── set-off ─────────────────────────────

export type Use = { igstIgst: number; igstCgst: number; igstSgst: number; cgstCgst: number; cgstIgst: number; sgstSgst: number; sgstIgst: number };

export type SetOff = {
  /** Output tax by head (never below 0). */
  liab: Heads;
  /** Reverse charge by head: paid in cash only. */
  rcm: Heads;
  /** Credit that could be used (brought forward + this month; never below 0). */
  credit: Heads;
  /** Credit that went below zero (notes took back more than there was): paid in cash. */
  reversal: Heads;
  use: Use;
  cash: Heads;
  /** Credit carried to next month. */
  close: Heads;
};

/**
 * Set input credit off against output tax as the law orders it (sections
 * 49 and 49A, rule 88A): IGST credit first, against IGST, then CGST and
 * SGST (here first where their own credit falls short, so less cash is
 * paid); then CGST credit against CGST, then IGST; SGST credit against
 * SGST, then IGST. CGST credit never pays SGST, nor SGST credit CGST.
 * Reverse charge is always paid in cash.
 */
export function setOff(input: { liab: Heads; rcm: Heads; credit: Heads }): SetOff {
  const liab = { igst: Math.max(0, input.liab.igst), cgst: Math.max(0, input.liab.cgst), sgst: Math.max(0, input.liab.sgst) };
  const rcm = { igst: Math.max(0, input.rcm.igst), cgst: Math.max(0, input.rcm.cgst), sgst: Math.max(0, input.rcm.sgst) };
  const reversal = { igst: Math.max(0, -input.credit.igst), cgst: Math.max(0, -input.credit.cgst), sgst: Math.max(0, -input.credit.sgst) };
  const credit = { igst: Math.max(0, input.credit.igst), cgst: Math.max(0, input.credit.cgst), sgst: Math.max(0, input.credit.sgst) };
  const use: Use = { igstIgst: 0, igstCgst: 0, igstSgst: 0, cgstCgst: 0, cgstIgst: 0, sgstSgst: 0, sgstIgst: 0 };

  let r = credit.igst;
  use.igstIgst = Math.min(r, liab.igst);
  r -= use.igstIgst;
  // IGST credit where CGST / SGST credit falls short, then (it must all be used first) the rest.
  const shortC = Math.max(0, liab.cgst - credit.cgst);
  const shortS = Math.max(0, liab.sgst - credit.sgst);
  use.igstCgst = Math.min(r, shortC);
  r -= use.igstCgst;
  use.igstSgst = Math.min(r, shortS);
  r -= use.igstSgst;
  const moreC = Math.min(r, liab.cgst - use.igstCgst);
  use.igstCgst += moreC;
  r -= moreC;
  const moreS = Math.min(r, liab.sgst - use.igstSgst);
  use.igstSgst += moreS;
  r -= moreS;

  let igstLeft = liab.igst - use.igstIgst;
  use.cgstCgst = Math.min(credit.cgst, liab.cgst - use.igstCgst);
  use.cgstIgst = Math.min(credit.cgst - use.cgstCgst, igstLeft);
  igstLeft -= use.cgstIgst;
  use.sgstSgst = Math.min(credit.sgst, liab.sgst - use.igstSgst);
  use.sgstIgst = Math.min(credit.sgst - use.sgstSgst, igstLeft);
  igstLeft -= use.sgstIgst;

  const cash = {
    igst: igstLeft + rcm.igst + reversal.igst,
    cgst: liab.cgst - use.igstCgst - use.cgstCgst + rcm.cgst + reversal.cgst,
    sgst: liab.sgst - use.igstSgst - use.sgstSgst + rcm.sgst + reversal.sgst,
  };
  const close = {
    igst: credit.igst - use.igstIgst - use.igstCgst - use.igstSgst,
    cgst: credit.cgst - use.cgstCgst - use.cgstIgst,
    sgst: credit.sgst - use.sgstSgst - use.sgstIgst,
  };
  return { liab, rcm, credit, reversal, use, cash, close };
}

export const usedTotal = (u: Use) => u.igstIgst + u.igstCgst + u.igstSgst + u.cgstCgst + u.cgstIgst + u.sgstSgst + u.sgstIgst;

// ───────────────────────────── matching numbers ─────────────────────────────

/** A supplier's document number reduced for matching: "inv/0012" and "INV-12" are the same. */
export function numberKey(n: string) {
  return n
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/(^|[^0-9])0+(?=[0-9])/g, "$1");
}

/** Tax and taxable value within this many paise of each other count as the same. */
export const MATCH_SLACK = 100;
