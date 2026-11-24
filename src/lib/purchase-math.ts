import { gstInside, gstOn } from "@/lib/money";
import { splitTax } from "@/lib/gst";

/** Purchase maths and labels, safe for the browser (the purchase form works the same numbers). */

export type PurchaseDocType = "BILL" | "DEBIT_NOTE" | "CREDIT_NOTE";
export type SupplierKind = "GOODS" | "SERVICES" | "OTHER";

export const GST_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
export const DOC_LABEL: Record<PurchaseDocType, string> = { BILL: "Purchase bill", DEBIT_NOTE: "Debit note to supplier", CREDIT_NOTE: "Credit note from supplier" };
export const SUPPLIER_KINDS: Record<SupplierKind, string> = { GOODS: "Company (goods we sell)", SERVICES: "Services (transport, rent, repairs …)", OTHER: "Other" };

export type LineMoney = { gross: number; discount: number; taxable: number; tax: number; cgst: number; sgst: number; igst: number; total: number };

/** One line: rate × qty, less discount %, GST on top (or taken out when rates include it). Paise. */
export function purchaseLineMoney(rate: number, quantity: number, discountPct: number, gstRate: number, inclusive: boolean, interState: boolean): LineMoney {
  const gross = rate * quantity;
  const discount = Math.round((gross * discountPct) / 100);
  const net = gross - discount;
  const tax = inclusive ? gstInside(net, gstRate) : gstOn(net, gstRate);
  const taxable = inclusive ? net - tax : net;
  return { gross, discount, taxable, tax, ...splitTax(tax, interState), total: taxable + tax };
}
