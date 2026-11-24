import { gstInside, gstOn } from "@/lib/money";
import { splitTax } from "@/lib/gst";

/** Purchase maths and labels, safe for the browser (the purchase form works the same numbers). */

export type PurchaseDocType = "BILL" | "DEBIT_NOTE" | "CREDIT_NOTE";
export type SupplierKind = "GOODS" | "SERVICES" | "OTHER";

export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
export const DOC_LABEL: Record<PurchaseDocType, string> = { BILL: "Purchase bill", DEBIT_NOTE: "Debit note to supplier", CREDIT_NOTE: "Credit note from supplier" };
export const SUPPLIER_KINDS: Record<SupplierKind, string> = { GOODS: "Company (goods we sell)", SERVICES: "Services (transport, rent, repairs …)", OTHER: "Other" };

export type LineMoney = { gross: number; discount: number; taxable: number; tax: number; cgst: number; sgst: number; igst: number; total: number };

/** Billed by the case (rate per case, units in a case) and further discounts after the first. */
export type LineExtra = { caseRate?: number | null; caseSize?: number | null; more?: number[] };

/**
 * One line: rate × qty (or, by the case, case rate × qty ÷ units in a case, so
 * the amount is the bill's to the paisa), less each discount % in turn on what
 * is left, GST on top (or taken out when rates include it). Paise.
 */
export function purchaseLineMoney(rate: number, quantity: number, discountPct: number, gstRate: number, inclusive: boolean, interState: boolean, x: LineExtra = {}): LineMoney {
  const gross = x.caseRate != null && x.caseSize ? Math.round((x.caseRate * quantity) / x.caseSize) : rate * quantity;
  let net = gross;
  let discount = 0;
  for (const d of [discountPct, ...(x.more ?? [])]) {
    if (!d) continue;
    const cut = Math.round((net * d) / 100);
    discount += cut;
    net -= cut;
  }
  const tax = inclusive ? gstInside(net, gstRate) : gstOn(net, gstRate);
  const taxable = inclusive ? net - tax : net;
  return { gross, discount, taxable, tax, ...splitTax(tax, interState), total: taxable + tax };
}

/** "10 + 5 + 2" (or "10,5") → [10, 5, 2]: up to three discounts, each 0 to 100. Blank → []. null = not readable. */
export function parseDiscounts(text: string): number[] | null {
  const t = text.trim();
  if (!t) return [];
  const parts = t.split(/[+,]/).map((x) => x.trim().replace(/%$/, ""));
  if (parts.length > 3 || parts.some((x) => !/^\d+(\.\d{1,2})?$/.test(x))) return null;
  const ds = parts.map(Number);
  return ds.every((d) => d >= 0 && d <= 100) ? ds : null;
}

/** [10, 5] → "10% + 5%". */
export const discountText = (ds: number[]) =>
  ds
    .filter((d) => d)
    .map((d) => `${d}%`)
    .join(" + ");
