import { MoneyError, type Ctx, type PaymentInput } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { deliverOrder, dispatchOrder, type ReturnableInput } from "@/lib/delivery";
import { quoteCart, retailerPricingCtx, type CartItemInput } from "@/lib/pricing";
import { stockOn, vanStock } from "@/lib/stock";
import type { Tx } from "@/lib/db";

/**
 * Spot sale (Phase 5): the driver sells free van stock to a shop on the
 * route. It is an ordinary order (same prices, schemes, credit rules and GST
 * documents), placed by the driver, added as a stop on their running trip,
 * and delivered at once from the van.
 */

/** The driver's running trip with a van, or a reason why spot sales aren't possible. */
export async function spotTrip(tx: Tx, agentId: string) {
  const trip = await tx.trip.findFirst({
    where: { driverId: agentId, status: "STARTED" },
    orderBy: { startedAt: "desc" },
    select: { id: true, number: true, vehicleId: true },
  });
  if (!trip) throw new MoneyError("Start your trip first. Spot sales come out of the van on a running trip.");
  if (!trip.vehicleId) throw new MoneyError("This trip has no van, so there is no van stock to sell.");
  return trip as { id: string; number: string; vehicleId: string };
}

/** Quantities the sale needs (lines + free goods) beyond the van's free stock. */
function overVan(needs: Map<string, number>, free: Map<string, { free: number; name: string; unit: string }>) {
  const over: { productId: string; name: string; want: number; free: number }[] = [];
  for (const [productId, want] of needs) {
    const f = free.get(productId);
    if (want > (f?.free ?? 0)) over.push({ productId, name: f?.name ?? "This product", want, free: f?.free ?? 0 });
  }
  return over;
}

/** Price a spot sale and check it against the van (no changes made). */
export async function quoteSpotSale(ctx: Ctx, agentId: string, retailerId: string, items: CartItemInput[]) {
  if (!(await stockOn(ctx))) throw new MoneyError("Stock tracking is off, so there is no van stock to sell.");
  const trip = await spotTrip(ctx.tx, agentId);
  const r = await retailerPricingCtx(ctx.tx, retailerId);
  if (!r) throw new MoneyError("Shop not found", 404);
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  // The van is what counts here, not warehouse availability.
  const quote = await quoteCart(ctx.tx, t.settings, r, { items, skipStockCheck: true });
  const van = await vanStock(ctx, trip.vehicleId);
  const free = new Map(van.rows.map((x) => [x.productId, { free: x.free, name: x.name, unit: x.unit }]));
  const needs = new Map<string, number>();
  for (const l of quote.lines) needs.set(l.productId, (needs.get(l.productId) ?? 0) + l.quantity);
  for (const f of quote.free) needs.set(f.productId, (needs.get(f.productId) ?? 0) + f.quantity);
  const over = overVan(needs, free);
  const problems = [...quote.problems, ...over.map((o) => (o.free > 0 ? `${o.name}: only ${o.free} free in the van` : `${o.name} isn't free in the van`))];
  return { trip, quote: { ...quote, problems }, van: van.rows, over };
}

export type SpotSaleInput = {
  agentId: string;
  driverUserId: string;
  retailerId: string;
  items: CartItemInput[];
  returnables?: ReturnableInput[];
  pod: { photo: string | null; signature: string | null; lat: number | null; lng: number | null; accuracy: number | null };
  collect: Omit<PaymentInput, "retailerId" | "orderId" | "purpose"> | null;
};

/** Place, dispatch and deliver a spot sale from the van, in one transaction. */
export async function spotSale(ctx: Ctx, input: SpotSaleInput, now = new Date()) {
  if (!(await stockOn(ctx))) throw new MoneyError("Stock tracking is off, so there is no van stock to sell.");
  const trip = await spotTrip(ctx.tx, input.agentId);
  const van = await vanStock(ctx, trip.vehicleId);
  const free = new Map(van.rows.map((x) => [x.productId, { free: x.free, name: x.name, unit: x.unit }]));

  const { order } = await placeOrder(ctx, { retailerId: input.retailerId, placedById: input.driverUserId, items: input.items, notes: `Spot sale on trip ${trip.number}`, now, skipStockCheck: true });
  if (order.creditHold) {
    throw new MoneyError(`This shop is over its credit limit (${order.creditHoldReason ?? "needs approval"}). Take payment first or ask the office.`, 409);
  }
  const needs = new Map<string, number>();
  for (const it of order.items) needs.set(it.productId, (needs.get(it.productId) ?? 0) + it.quantity);
  const over = overVan(needs, free);
  if (over.length) {
    throw new MoneyError(`Not enough free in the van: ${over.map((o) => `${o.name} (${o.free} free)`).join(", ")}`, 409);
  }

  await ctx.tx.order.update({ where: { id: order.id }, data: { spot: true } });
  const last = await ctx.tx.delivery.aggregate({ where: { tripId: trip.id }, _max: { seq: true } });
  await ctx.tx.delivery.create({ data: { orderId: order.id, deliveryAgentId: input.agentId, tripId: trip.id, seq: (last._max.seq ?? 0) + 1, state: "ASSIGNED" } });
  const dispatched = await dispatchOrder(ctx, order.id, `Spot sale on trip ${trip.number}`, { noCode: true });
  const done = await deliverOrder(
    ctx,
    { orderId: order.id, agentId: input.agentId, office: false, lines: undefined, returnables: input.returnables, pod: input.pod, collect: input.collect },
    now
  );
  return { order: done.order, tripId: trip.id, invoice: done.invoice ?? dispatched, payment: done.payment, totalAmount: done.totalAmount };
}
