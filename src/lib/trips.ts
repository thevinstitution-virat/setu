import { MoneyError, cashInHand, type Ctx } from "@/lib/ledger";
import { docNumber, fyCode, istDate } from "@/lib/gst";
import { nextSequence } from "@/lib/orders";
import { deliverySettings } from "@/lib/delivery-settings";
import { dispatchOrder, failDelivery } from "@/lib/delivery";

/**
 * Trips (Phase 4): one vehicle + driver + slot + day, with ordered stops.
 * PLANNED (office loads orders) → STARTED (orders go out for delivery and
 * are invoiced when the tenant invoices at dispatch) → CLOSED (day close:
 * load vs delivered vs returned vs cash, frozen in closeSummary).
 *
 * Stops are Delivery rows (one per order) carrying tripId and seq.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymdDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

export async function createTrip(
  ctx: Ctx,
  t: { date: string; slot: string; driverId: string; vehicleId?: string | null; note?: string | null },
  now = new Date()
) {
  if (!YMD.test(t.date)) throw new MoneyError("Pick a date");
  const settings = deliverySettings((await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } })).settings);
  if (!settings.slots.some((s) => s.key === t.slot)) throw new MoneyError("Pick a slot");
  // Foreign keys are not filtered by row-level security: check they're ours.
  const driver = await ctx.tx.deliveryAgentProfile.findUnique({ where: { id: t.driverId }, include: { user: { select: { active: true } } } });
  if (!driver || !driver.user.active) throw new MoneyError("Driver not found", 404);
  if (t.vehicleId) {
    const v = await ctx.tx.vehicle.findUnique({ where: { id: t.vehicleId } });
    if (!v || !v.active) throw new MoneyError("Vehicle not found", 404);
  }
  const fy = fyCode(now);
  const number = docNumber("TRP", fy, await nextSequence(ctx.tx, ctx.tenantId, `trip:${fy}`));
  return ctx.tx.trip.create({
    data: {
      number,
      date: ymdDate(t.date),
      slot: t.slot,
      driverId: t.driverId,
      vehicleId: t.vehicleId || null,
      note: t.note?.trim().slice(0, 200) || null,
      createdById: ctx.actorId,
    },
  });
}

async function openTrip(ctx: Ctx, tripId: string) {
  const trip = await ctx.tx.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new MoneyError("Trip not found", 404);
  if (trip.status === "CLOSED") throw new MoneyError("This trip is closed");
  return trip;
}

/** Change driver, vehicle, slot, date or note of a trip that hasn't left. */
export async function updateTrip(ctx: Ctx, tripId: string, p: { driverId?: string; vehicleId?: string | null; note?: string | null; slot?: string; date?: string }) {
  const trip = await openTrip(ctx, tripId);
  const data: Record<string, unknown> = {};
  if (p.note !== undefined) data.note = p.note?.trim().slice(0, 200) || null;
  if (p.vehicleId !== undefined) {
    if (p.vehicleId) {
      const v = await ctx.tx.vehicle.findUnique({ where: { id: p.vehicleId } });
      if (!v || !v.active) throw new MoneyError("Vehicle not found", 404);
    }
    data.vehicleId = p.vehicleId || null;
  }
  if (p.driverId !== undefined || p.slot !== undefined || p.date !== undefined) {
    if (trip.status !== "PLANNED") throw new MoneyError("The trip has left: driver, day and slot can't change");
    if (p.driverId) {
      const d = await ctx.tx.deliveryAgentProfile.findUnique({ where: { id: p.driverId }, include: { user: { select: { active: true } } } });
      if (!d || !d.user.active) throw new MoneyError("Driver not found", 404);
      data.driverId = p.driverId;
      await ctx.tx.delivery.updateMany({ where: { tripId }, data: { deliveryAgentId: p.driverId } });
    }
    if (p.slot) {
      const s = deliverySettings((await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } })).settings);
      if (!s.slots.some((x) => x.key === p.slot)) throw new MoneyError("Pick a slot");
      data.slot = p.slot;
    }
    if (p.date) {
      if (!YMD.test(p.date)) throw new MoneyError("Pick a date");
      data.date = ymdDate(p.date);
    }
  }
  return ctx.tx.trip.update({ where: { id: tripId }, data });
}

/** Put orders on a trip. On a trip that has already left they go out at once. Returns invoices issued. */
export async function addOrders(ctx: Ctx, tripId: string, orderIds: string[]) {
  const trip = await openTrip(ctx, tripId);
  if (!orderIds.length) throw new MoneyError("Pick at least one order");
  const last = await ctx.tx.delivery.aggregate({ where: { tripId }, _max: { seq: true } });
  let seq = last._max.seq ?? 0;
  const docs: { id: string; einvStatus: string }[] = [];
  for (const orderId of [...new Set(orderIds)]) {
    const order = await ctx.tx.order.findUnique({ where: { id: orderId }, include: { delivery: { include: { trip: { select: { id: true, number: true, status: true } } } } } });
    if (!order) throw new MoneyError("Order not found", 404);
    if (!["PLACED", "CONFIRMED", "PACKED"].includes(order.status) && !(order.status === "OUT_FOR_DELIVERY" && !order.delivery?.tripId)) {
      throw new MoneyError(`${order.orderNumber} can't go on a trip (it is ${order.status.toLowerCase().replace(/_/g, " ")})`);
    }
    if (order.creditHold && !order.creditApprovedAt) throw new MoneyError(`${order.orderNumber} is on credit hold`, 409);
    const other = order.delivery?.trip;
    if (other && other.id !== tripId && other.status !== "CLOSED") {
      throw new MoneyError(`${order.orderNumber} is already on trip ${other.number}. Close that trip or take it off first.`);
    }
    if (other?.id === tripId && order.delivery?.state === "ASSIGNED") continue;
    seq += 1;
    const stop = { deliveryAgentId: trip.driverId, tripId, seq, state: "ASSIGNED" as const, deliveredAt: null, failReason: null, failNote: null, failedAt: null, code: null, codeVerified: false };
    await ctx.tx.delivery.upsert({ where: { orderId }, update: stop, create: { orderId, ...stop } });
    if (trip.status === "STARTED") {
      const inv = await dispatchOrder(ctx, orderId, `Out for delivery on trip ${trip.number}`);
      if (inv) docs.push(inv);
    }
  }
  return docs;
}

/** Take an order off a trip that hasn't left. */
export async function removeOrder(ctx: Ctx, tripId: string, orderId: string) {
  const trip = await openTrip(ctx, tripId);
  if (trip.status !== "PLANNED") throw new MoneyError("The trip has left. Mark the stop “Not delivered” instead.");
  const d = await ctx.tx.delivery.findUnique({ where: { orderId } });
  if (!d || d.tripId !== tripId) throw new MoneyError("That order isn't on this trip", 404);
  await ctx.tx.delivery.delete({ where: { orderId } });
  await renumber(ctx, tripId);
}

async function renumber(ctx: Ctx, tripId: string) {
  const stops = await ctx.tx.delivery.findMany({ where: { tripId }, orderBy: [{ seq: "asc" }, { assignedAt: "asc" }], select: { id: true, seq: true } });
  for (const [i, s] of stops.entries()) if (s.seq !== i + 1) await ctx.tx.delivery.update({ where: { id: s.id }, data: { seq: i + 1 } });
}

/** Set the stop order by hand: orderIds must list every stop on the trip. */
export async function reorderStops(ctx: Ctx, tripId: string, orderIds: string[]) {
  await openTrip(ctx, tripId);
  const stops = await ctx.tx.delivery.findMany({ where: { tripId }, select: { id: true, orderId: true } });
  if (orderIds.length !== stops.length || new Set(orderIds).size !== stops.length || !stops.every((s) => orderIds.includes(s.orderId))) {
    throw new MoneyError("Send every stop on the trip once");
  }
  for (const [i, orderId] of orderIds.entries()) {
    await ctx.tx.delivery.update({ where: { orderId }, data: { seq: i + 1 } });
  }
}

const RAD = Math.PI / 180;
/** Distance in km between two points (haversine). */
export function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export type RoutePoint = { id: string; lat: number | null; lng: number | null; area: string; pinCode: string; name: string };

/**
 * Route order: nearest next stop from the start point, for stops with a map
 * pin; stops without one follow, grouped by area and PIN code. Plain maths,
 * no maps service: good enough to start the day, the office can still drag.
 */
export function sequenceStops(points: RoutePoint[], start: { lat: number; lng: number } | null) {
  const located = points.filter((p) => p.lat !== null && p.lng !== null) as (RoutePoint & { lat: number; lng: number })[];
  const rest = points
    .filter((p) => p.lat === null || p.lng === null)
    .sort((a, b) => a.area.localeCompare(b.area) || a.pinCode.localeCompare(b.pinCode) || a.name.localeCompare(b.name));
  const out: RoutePoint[] = [];
  let here = start ?? located[0] ?? null;
  const left = [...located];
  while (left.length && here) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (km(here, left[i]) < km(here, left[best])) best = i;
    const [next] = left.splice(best, 1);
    out.push(next);
    here = next;
  }
  return [...out, ...rest];
}

/** Re-order the stops still to be visited; done stops keep their place at the front. */
export async function autoSequence(ctx: Ctx, tripId: string) {
  await openTrip(ctx, tripId);
  const s = deliverySettings((await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } })).settings);
  const stops = await ctx.tx.delivery.findMany({
    where: { tripId },
    orderBy: { seq: "asc" },
    include: { order: { select: { retailer: { select: { lat: true, lng: true, pinCode: true, outletName: true, area: { select: { name: true } } } } } } },
  });
  const done = stops.filter((x) => x.state !== "ASSIGNED");
  const todo = stops.filter((x) => x.state === "ASSIGNED");
  const lastDone = [...done].reverse().find((x) => x.order.retailer.lat !== null);
  const start = lastDone ? { lat: lastDone.order.retailer.lat!, lng: lastDone.order.retailer.lng! } : s.depot;
  const ordered = sequenceStops(
    todo.map((x) => ({ id: x.orderId, lat: x.order.retailer.lat, lng: x.order.retailer.lng, area: x.order.retailer.area.name, pinCode: x.order.retailer.pinCode, name: x.order.retailer.outletName })),
    start
  );
  await reorderStops(ctx, tripId, [...done.map((x) => x.orderId), ...ordered.map((p) => p.id)]);
  return { located: todo.filter((x) => x.order.retailer.lat !== null).length, total: todo.length };
}

/** The trip leaves: every stop goes out for delivery. Returns invoices issued (for e-invoicing). */
export async function startTrip(ctx: Ctx, tripId: string, now = new Date()) {
  const trip = await openTrip(ctx, tripId);
  if (trip.status !== "PLANNED") throw new MoneyError("This trip has already left");
  const stops = await ctx.tx.delivery.findMany({ where: { tripId, state: "ASSIGNED" }, orderBy: { seq: "asc" }, select: { orderId: true } });
  if (!stops.length) throw new MoneyError("Add orders to the trip first");
  const docs: { id: string; einvStatus: string }[] = [];
  for (const s of stops) {
    const inv = await dispatchOrder(ctx, s.orderId, `Out for delivery on trip ${trip.number}`);
    if (inv) docs.push(inv);
  }
  await ctx.tx.trip.update({ where: { id: tripId }, data: { status: "STARTED", startedAt: now, startedById: ctx.actorId } });
  // Leaving on a trip puts the driver on duty.
  const driver = await ctx.tx.deliveryAgentProfile.findUniqueOrThrow({ where: { id: trip.driverId }, select: { userId: true } });
  const onDuty = await ctx.tx.dutyShift.findFirst({ where: { userId: driver.userId, endAt: null } });
  if (!onDuty) await ctx.tx.dutyShift.create({ data: { userId: driver.userId, startAt: now } });
  return { docs, orderIds: stops.map((s) => s.orderId) };
}

export type TripSummary = {
  stops: number;
  delivered: number;
  failed: number;
  pending: number;
  products: { productId: string; name: string; unit: string; loaded: number; delivered: number; returned: number }[];
  /** Value of goods that left (order totals at dispatch) and of what was handed over (after short-delivery credits). */
  value: { loaded: number; delivered: number };
  /** Collected by the driver at this trip's stops, per method (paise). */
  collected: Record<string, number>;
  /** Cash the driver should hand over for this trip. */
  cashExpected: number;
  /** Driver's whole cash in hand right now (this and earlier trips). */
  cashInHand: number;
  returnables: { returnableId: string; name: string; given: number; taken: number }[];
  failedStops: { orderNumber: string; outletName: string; reason: string | null }[];
};

/** Load sheet and day-close figures of a trip, computed from live data. */
export async function tripSummary(ctx: Ctx, tripId: string): Promise<TripSummary> {
  const trip = await ctx.tx.trip.findUnique({ where: { id: tripId }, include: { driver: { select: { userId: true } } } });
  if (!trip) throw new MoneyError("Trip not found", 404);
  const stops = await ctx.tx.delivery.findMany({
    where: { tripId },
    orderBy: { seq: "asc" },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          totalAmount: true,
          orderedTotal: true,
          retailer: { select: { outletName: true } },
          items: { select: { productId: true, quantity: true, orderedQty: true, deliveredQty: true, product: { select: { name: true, unit: true } } } },
          invoices: { select: { type: true, total: true } },
        },
      },
    },
  });
  const products = new Map<string, TripSummary["products"][number]>();
  let loadedValue = 0;
  let deliveredValue = 0;
  for (const s of stops) {
    const docs = s.order.invoices;
    const sale = docs.find((d) => d.type === "TAX_INVOICE" || d.type === "BILL_OF_SUPPLY");
    const credits = docs.filter((d) => d.type === "CREDIT_NOTE").reduce((a, d) => a + d.total, 0);
    // What left on the van: the dispatch invoice, else the order as ordered.
    loadedValue += s.order.orderedTotal ?? sale?.total ?? s.order.totalAmount;
    if (s.state === "DELIVERED") deliveredValue += sale ? sale.total - credits : s.order.totalAmount;
    for (const it of s.order.items) {
      const loaded = it.orderedQty ?? it.quantity;
      const delivered = s.state === "DELIVERED" ? (it.deliveredQty ?? it.quantity) : 0;
      const row = products.get(it.productId) ?? { productId: it.productId, name: it.product.name, unit: it.product.unit, loaded: 0, delivered: 0, returned: 0 };
      row.loaded += loaded;
      row.delivered += delivered;
      row.returned += loaded - delivered;
      products.set(it.productId, row);
    }
  }

  const orderIds = stops.map((s) => s.orderId);
  const payments = orderIds.length
    ? await ctx.tx.payment.findMany({
        where: { orderId: { in: orderIds }, collectedById: trip.driver.userId, method: { in: ["CASH", "UPI", "CHEQUE", "BANK"] }, state: { not: "REJECTED" } },
        select: { method: true, amount: true },
      })
    : [];
  const collected: Record<string, number> = {};
  for (const p of payments) collected[p.method] = (collected[p.method] ?? 0) + p.amount;

  const moves = await ctx.tx.returnableMove.groupBy({ by: ["returnableId"], where: { tripId }, _sum: { given: true, taken: true } });
  const names = moves.length ? await ctx.tx.returnable.findMany({ where: { id: { in: moves.map((m) => m.returnableId) } }, select: { id: true, name: true } }) : [];

  return {
    stops: stops.length,
    delivered: stops.filter((s) => s.state === "DELIVERED").length,
    failed: stops.filter((s) => s.state === "FAILED").length,
    pending: stops.filter((s) => s.state === "ASSIGNED").length,
    products: [...products.values()].sort((a, b) => a.name.localeCompare(b.name)),
    value: { loaded: loadedValue, delivered: deliveredValue },
    collected,
    cashExpected: collected.CASH ?? 0,
    cashInHand: await cashInHand(ctx, trip.driver.userId),
    returnables: moves.map((m) => ({
      returnableId: m.returnableId,
      name: names.find((n) => n.id === m.returnableId)?.name ?? "",
      given: m._sum.given ?? 0,
      taken: m._sum.taken ?? 0,
    })),
    failedStops: stops
      .filter((s) => s.state === "FAILED")
      .map((s) => ({ orderNumber: s.order.orderNumber, outletName: s.order.retailer.outletName, reason: s.failReason })),
  };
}

/**
 * Day close. Stops not attempted are marked not delivered ("Ran out of
 * time") only when force is set; otherwise closing is refused.
 */
export async function closeTrip(ctx: Ctx, tripId: string, opts: { force?: boolean } = {}, now = new Date()) {
  const trip = await openTrip(ctx, tripId);
  if (trip.status !== "STARTED") throw new MoneyError("Only a trip that has left can be closed");
  const pending = await ctx.tx.delivery.findMany({ where: { tripId, state: "ASSIGNED" }, select: { orderId: true } });
  if (pending.length && !opts.force) {
    throw new MoneyError(`${pending.length} stop${pending.length > 1 ? "s are" : " is"} still open. Deliver them, mark them not delivered, or close anyway.`, 409);
  }
  for (const p of pending) await failDelivery(ctx, p.orderId, { reason: "no_time", note: "Trip closed before this stop" }, now);
  const summary = await tripSummary(ctx, tripId);
  await ctx.tx.trip.update({
    where: { id: tripId },
    data: { status: "CLOSED", closedAt: now, closedById: ctx.actorId, closeSummary: summary as unknown as object },
  });
  return summary;
}

/** The IST calendar day as stored in Trip.date. */
export function tripDay(d = new Date()) {
  return ymdDate(istDate(d));
}
