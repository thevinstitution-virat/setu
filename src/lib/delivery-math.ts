import { gstOn } from "@/lib/money";

/**
 * Pure delivery maths, safe to import in the browser (the driver's screen
 * shows the amount to collect before saving). The server uses the same
 * functions, so the preview and the saved figures agree.
 */

export type DeliveryItem = {
  id: string;
  quantity: number;
  price: number;
  gstRate: number;
  discount: number;
  freeSchemeId: string | null;
  orderedQty: number | null;
  cases: number | null;
  caseSize: number | null;
};

/**
 * Lines and totals of an order cut to the delivered quantities (invoice at
 * delivery). Discount follows the quantity; the delivery charge stays.
 * Same rounding as the cart quote, so the invoice check still passes.
 */
export function repriceOrder(
  order: { deliveryCharge: number; deliveryGstRate: number },
  lines: { item: DeliveryItem; delivered: number }[]
) {
  const items = lines.map(({ item, delivered }) => {
    const ordered = item.orderedQty ?? item.quantity;
    const discount = ordered === 0 ? 0 : Math.round((item.discount * delivered) / ordered);
    const cases = item.caseSize && delivered % item.caseSize === 0 && item.cases ? delivered / item.caseSize : null;
    return { id: item.id, quantity: delivered, discount, cases, price: item.price, gstRate: item.gstRate, free: !!item.freeSchemeId || item.price === 0 };
  });
  const paid = items.filter((i) => !i.free);
  const grossAmount = paid.reduce((a, i) => a + i.price * i.quantity, 0);
  const discountAmount = paid.reduce((a, i) => a + i.discount, 0);
  const goodsTax = paid.reduce((a, i) => a + gstOn(i.price * i.quantity - i.discount, i.gstRate), 0);
  const subtotal = grossAmount - discountAmount + order.deliveryCharge;
  const gstAmount = goodsTax + gstOn(order.deliveryCharge, order.deliveryGstRate);
  return { items, grossAmount, discountAmount, subtotal, gstAmount, totalAmount: subtotal + gstAmount };
}

/**
 * Credit for goods not handed over on an invoice issued at dispatch: per
 * line, the share of the line's taxable value plus its GST (the same rule as
 * a "return" credit note on a fresh invoice line; the server has the final say).
 */
export function shortCredit(lines: { taxable: number; gstRate: number; quantity: number; short: number }[]) {
  return lines.reduce((a, l) => {
    if (l.short <= 0 || l.quantity <= 0) return a;
    const taxable = l.short === l.quantity ? l.taxable : Math.round((l.taxable * l.short) / l.quantity);
    return a + taxable + gstOn(taxable, l.gstRate);
  }, 0);
}
