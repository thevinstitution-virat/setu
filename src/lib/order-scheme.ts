import { MoneyError, type Ctx } from "@/lib/ledger";
import { lineMoney } from "@/lib/money";
import { repriceOrder } from "@/lib/delivery-math";
import { dealFree, type Deal } from "@/lib/deal";

/**
 * A scheme or deal the office types on one line of an order before it is
 * billed, on top of the automatic schemes (Admin → Schemes).
 *
 * - scheme: an amount off the line, in paise, against the rate as charged
 *   (with GST when the order's rates include GST, like the other discounts).
 *   It is kept in `extraScheme` and added to the line's `discount`.
 * - deal: `get` free for every `buy` (cases when the line was ordered in
 *   cases). It makes one free-goods line (price 0) of the same product,
 *   linked by `dealForItemId`; null takes it off.
 *
 * The order's totals are worked out again with the delivery maths, the same
 * rounding as the cart, so the invoice check still passes. Only while the
 * order is open and has no sale invoice.
 */
export type LineSchemeInput = { scheme: number; deal: Deal | null };

export async function setLineScheme(ctx: Ctx, orderId: string, itemId: string, input: LineSchemeInput) {
  const { tx } = ctx;
  const { scheme, deal } = input;
  if (!Number.isInteger(scheme) || scheme < 0 || scheme > 100_000_000_000) throw new MoneyError("Write the scheme in rupees and paise");
  if (deal && (!Number.isInteger(deal.buy) || !Number.isInteger(deal.get) || deal.buy < 1 || deal.get < 1)) {
    throw new MoneyError("A deal looks like 10+1 (1 free for every 10)");
  }

  // Lock the order so a dispatch or delivery can't bill it halfway through.
  await tx.$queryRaw`SELECT 1 FROM "Order" WHERE "id" = ${orderId} FOR UPDATE`;
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw new MoneyError("Not found", 404);
  if (order.status === "CANCELLED" || order.status === "DELIVERED" || order.status === "OUT_FOR_DELIVERY") {
    throw new MoneyError("Schemes can be changed only before the order goes out", 409);
  }
  const billed = await tx.invoice.findFirst({ where: { orderId, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } }, select: { number: true } });
  if (billed) throw new MoneyError(`This order is already billed (${billed.number}); give a credit note instead`, 409);

  const item = order.items.find((i) => i.id === itemId);
  if (!item) throw new MoneyError("That line isn't on this order", 404);
  if (item.price === 0 || item.freeSchemeId || item.dealForItemId) throw new MoneyError("This line is free goods; put the scheme on the line that is sold");

  const discount = item.discount - item.extraScheme + scheme;
  const m = lineMoney(item.price, item.quantity, discount, item.gstRate, order.taxInclusive);
  if (m.taxable <= 0 || m.total <= 0) throw new MoneyError("The scheme is more than the line after its discounts");

  const free = deal ? dealFree(item, deal) : 0;
  if (deal && free === 0) {
    throw new MoneyError(`The deal ${deal.buy}+${deal.get} gives nothing on ${item.cases && item.caseSize ? `${item.cases} cases` : item.quantity}`);
  }

  await tx.orderItem.update({
    where: { id: item.id },
    data: { discount, extraScheme: scheme, dealBuy: deal?.buy ?? null, dealGet: deal?.get ?? null },
  });
  await tx.orderItem.deleteMany({ where: { orderId, dealForItemId: item.id } });
  if (free > 0) {
    await tx.orderItem.create({
      data: { orderId, productId: item.productId, quantity: free, price: 0, gstRate: item.gstRate, mrp: item.mrp, dealForItemId: item.id },
    });
  }

  const items = await tx.orderItem.findMany({ where: { orderId } });
  const t = repriceOrder(order, items.map((i) => ({ item: i, delivered: i.quantity })));
  return tx.order.update({
    where: { id: orderId },
    data: { grossAmount: t.grossAmount, discountAmount: t.discountAmount, subtotal: t.subtotal, gstAmount: t.gstAmount, roundOff: t.roundOff, totalAmount: t.totalAmount },
    include: { items: true },
  });
}
