import { repriceOrder, shortCredit } from "@/lib/delivery-math";
import { SHORT_REASONS } from "@/lib/delivery-settings";
import type { DeliveryInvoice } from "./DeliveryInvoiceCard";

/**
 * Pure state and maths of the deliver screen: delivered quantity per line,
 * the amount for this order after short lines, and the checks before saving.
 * Uses the same functions as the server, so the preview matches the bill.
 */

export type DeliverItem = {
  id: string;
  quantity: number;
  orderedQty: number | null;
  deliveredQty: number | null;
  shortReason: string | null;
  price: number;
  gstRate: number;
  discount: number;
  mrp: number | null;
  freeSchemeId: string | null;
  cases: number | null;
  caseSize: number | null;
  product: { name: string; unit: string | null; caseUnit: string | null };
};

/** Per order line: quantity handed over and, when short, the SHORT_REASONS key. */
export type LineState = Record<string, { qty: number; reason: string }>;

export const orderedOf = (i: Pick<DeliverItem, "orderedQty" | "quantity">) => i.orderedQty ?? i.quantity;
export const fullLines = (items: DeliverItem[]): LineState =>
  Object.fromEntries(items.map((i) => [i.id, { qty: orderedOf(i), reason: "" }]));
export const deliveredOf = (lines: LineState, i: DeliverItem) => lines[i.id]?.qty ?? orderedOf(i);
export const isShort = (lines: LineState, i: DeliverItem) => deliveredOf(lines, i) < orderedOf(i);

export const isSale = (d: DeliveryInvoice) => d.type === "TAX_INVOICE" || d.type === "BILL_OF_SUPPLY";
/** Sale + debit notes − credit notes already issued for the order. */
export const bookedTotal = (docs: DeliveryInvoice[]) =>
  docs.reduce((s, d) => s + (d.type === "CREDIT_NOTE" ? -d.total : d.total), 0);

export const shortReasonLabel = (r: string | null | undefined) =>
  r && r in SHORT_REASONS ? SHORT_REASONS[r as keyof typeof SHORT_REASONS] : null;

/**
 * Value of this order for what is handed over.
 * - invoiced at dispatch: the documents so far minus the credit for short lines;
 * - not invoiced yet: the order repriced to the delivered quantities.
 * `full` is the value if everything is handed over.
 */
export function orderAmount(
  order: { totalAmount: number; deliveryCharge: number; deliveryGstRate: number },
  items: DeliverItem[],
  lines: LineState,
  invoices: DeliveryInvoice[]
) {
  const invoiced = invoices.some(isSale);
  const anyShort = items.some((i) => isShort(lines, i));
  if (invoiced) {
    const booked = bookedTotal(invoices);
    const credit = shortCredit(
      items.map((i) => {
        const ordered = orderedOf(i);
        return { taxable: i.price * ordered - i.discount, gstRate: i.gstRate, quantity: ordered, short: ordered - deliveredOf(lines, i) };
      })
    );
    return { invoiced, booked, full: booked, amount: booked - credit, anyShort };
  }
  const amount = anyShort
    ? repriceOrder(order, items.map((item) => ({ item, delivered: deliveredOf(lines, item) }))).totalAmount
    : order.totalAmount;
  return { invoiced, booked: 0, full: order.totalAmount, amount, anyShort };
}

/** Body lines for POST /deliver: every line, with a reason where short. */
export const linesBody = (items: DeliverItem[], lines: LineState) =>
  items.map((i) => {
    const quantity = deliveredOf(lines, i);
    return quantity < orderedOf(i) ? { itemId: i.id, quantity, reason: lines[i.id]?.reason } : { itemId: i.id, quantity };
  });

/** Client check of the lines; the server checks again. */
export function linesError(items: DeliverItem[], lines: LineState): string | null {
  if (items.every((i) => deliveredOf(lines, i) === 0)) return "Nothing is being handed over. Use “Couldn't deliver” instead.";
  if (items.some((i) => isShort(lines, i) && !((lines[i.id]?.reason ?? "") in SHORT_REASONS))) return "Pick a reason for every line with less than ordered";
  return null;
}

/** Paise → rupees as typed in the amount box ("" for 0). */
export const rupees = (p: number) => (p > 0 ? (p / 100).toFixed(2).replace(/\.00$/, "") : "");
