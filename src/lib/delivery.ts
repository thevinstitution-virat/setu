import { randomInt } from "node:crypto";
import { repriceOrder, type DeliveryItem } from "@/lib/delivery-math";
import {
  MoneyError,
  bookSale,
  chargeDebit,
  issueCreditNote,
  onOrderDelivered,
  onOrderDispatched,
  type Ctx,
  type PaymentInput,
} from "@/lib/ledger";
import {
  FAIL_REASONS,
  SHORT_REASONS,
  deliverySettings,
  isFailReason,
  isShortReason,
  type FailReason,
} from "@/lib/delivery-settings";
import { sellDelivered } from "@/lib/stock";

/**
 * Delivery operations on one order (Phase 4): dispatch with a delivery code,
 * line-level delivery (deliver / fewer / none per line, with a reason),
 * failed attempts, crates and jars, and the shop's location.
 *
 * Money stays exact:
 * - invoiced at dispatch → what wasn't handed over is credited with a
 *   "return" credit note on the invoice;
 * - invoiced at delivery → the order lines are cut to what was handed over
 *   (discount in proportion) before the invoice is issued, so the invoice
 *   shows only delivered goods.
 */

export type LineInput = { itemId: string; quantity: number; reason?: string | null };
export type ReturnableInput = { returnableId: string; given: number; taken: number };

type Item = DeliveryItem;
export { repriceOrder };

/** Check the delivered quantities against the order; missing lines are delivered in full. */
export function resolveLines<T extends Item>(items: T[], lines: LineInput[] | undefined) {
  const byId = new Map((lines ?? []).map((l) => [l.itemId, l]));
  for (const l of lines ?? []) if (!items.some((i) => i.id === l.itemId)) throw new MoneyError("A line isn't on this order");
  const out = items.map((it) => {
    const ordered = it.orderedQty ?? it.quantity;
    const want = byId.get(it.id);
    const delivered = want ? Number(want.quantity) : ordered;
    if (!Number.isInteger(delivered) || delivered < 0 || delivered > ordered) {
      throw new MoneyError(`Delivered quantity must be between 0 and ${ordered}`);
    }
    let reason: string | null = null;
    if (delivered < ordered) {
      if (!isShortReason(want?.reason)) throw new MoneyError("Pick a reason for every line delivered short");
      reason = want!.reason!;
    }
    return { item: it, ordered, delivered, reason };
  });
  if (out.every((l) => l.delivered === 0)) {
    throw new MoneyError("Nothing was handed over. Use “Not delivered” instead.");
  }
  return out;
}

const fourDigits = () => String(randomInt(0, 10_000)).padStart(4, "0");

/**
 * Order leaves on a trip: Out for delivery, invoice (when issued at
 * dispatch) and a delivery code for high-value drops. Idempotent; returns
 * the invoice only when this call issued it.
 */
export async function dispatchOrder(ctx: Ctx, orderId: string, note = "Out for delivery", opts: { noCode?: boolean } = {}) {
  const order = await ctx.tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { delivery: true } });
  if (order.status === "DELIVERED" || order.status === "CANCELLED") throw new MoneyError(`${order.orderNumber} can no longer be dispatched`);
  if (order.creditHold && !order.creditApprovedAt) throw new MoneyError(`${order.orderNumber} is on credit hold`, 409);
  if (order.status !== "OUT_FOR_DELIVERY") {
    await ctx.tx.order.update({
      where: { id: orderId },
      data: { status: "OUT_FOR_DELIVERY", statusEvents: { create: { status: "OUT_FOR_DELIVERY", actorId: ctx.actorId, note } } },
    });
  }
  const had = await ctx.tx.invoice.count({ where: { orderId, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } } });
  const issued = await onOrderDispatched(ctx, orderId);
  const invoice = had ? null : issued;
  if (order.delivery && !order.delivery.code && !opts.noCode) {
    const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
    const { codeAbove } = deliverySettings(t.settings);
    if (codeAbove > 0 && order.totalAmount >= codeAbove) {
      await ctx.tx.delivery.update({ where: { orderId }, data: { code: fourDigits() } });
    }
  }
  return invoice;
}

export type DeliverInput = {
  orderId: string;
  /** The delivery agent's profile id, or null for the office (counter pickup). */
  agentId: string | null;
  office: boolean;
  lines?: LineInput[];
  code?: string | null;
  returnables?: ReturnableInput[];
  pod: { photo: string | null; signature: string | null; lat: number | null; lng: number | null; accuracy: number | null };
  collect: Omit<PaymentInput, "retailerId" | "orderId" | "purpose"> | null;
};

/** Mark an order delivered, line by line. Runs inside withMoney. */
export async function deliverOrder(ctx: Ctx, input: DeliverInput, now = new Date()) {
  const order = await ctx.tx.order.findUniqueOrThrow({
    where: { id: input.orderId },
    include: { items: { orderBy: { id: "asc" } }, delivery: true, retailer: { select: { id: true, lat: true } } },
  });
  if (order.status === "DELIVERED" || order.status === "CANCELLED") throw new MoneyError("This order can no longer be delivered");
  if (order.creditHold && !order.creditApprovedAt) throw new MoneyError(`On credit hold: ${order.creditHoldReason ?? "needs approval"}`, 409);

  // A driver delivers only an open stop that is out for delivery (not one marked not delivered).
  if (!input.office && (order.status !== "OUT_FOR_DELIVERY" || (order.delivery && order.delivery.state !== "ASSIGNED"))) {
    throw new MoneyError("This stop isn't open any more. Ask the office to put the order on a trip again.", 409);
  }
  const t = await ctx.tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  const ds = deliverySettings(t.settings);
  if (ds.photoRequired && !input.office && !input.pod.photo) throw new MoneyError("Take a delivery photo first");
  const d = order.delivery;
  if (d?.code && !input.office && String(input.code ?? "").trim() !== d.code) {
    throw new MoneyError(input.code ? "That delivery code is wrong. Ask the retailer to check the order in their app." : "Enter the delivery code from the retailer", 400);
  }

  const lines = resolveLines(order.items, input.lines);
  const short = lines.filter((l) => l.delivered < l.ordered);
  const reasonText = short
    .map((l) => `${SHORT_REASONS[l.reason as keyof typeof SHORT_REASONS]} (${l.ordered - l.delivered})`)
    .join(", ");

  let creditNote = null;
  let totalAmount = order.totalAmount;
  const sale = await ctx.tx.invoice.findFirst({
    where: { orderId: order.id, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } },
    include: { lines: true },
  });

  if (sale) {
    // Invoiced at dispatch: credit what wasn't handed over.
    if (short.length) {
      const noteLines = short.map((l) => {
        const il = sale.lines.find((x) => x.orderItemId === l.item.id);
        if (!il) throw new MoneyError("The invoice doesn't have this order line", 409);
        return { lineId: il.id, quantity: l.ordered - l.delivered };
      });
      creditNote = await issueCreditNote(ctx, { invoiceId: sale.id, kind: "return", reason: `Not delivered: ${reasonText}`, lines: noteLines }, now);
      totalAmount = sale.total - creditNote.total;
    }
    for (const l of lines) {
      await ctx.tx.orderItem.update({ where: { id: l.item.id }, data: { deliveredQty: l.delivered, shortReason: l.reason } });
    }
  } else {
    // Invoice at delivery: cut the order to what was handed over, then invoice it.
    if (short.length) {
      const r = repriceOrder(order, lines);
      for (const it of r.items) {
        const l = lines.find((x) => x.item.id === it.id)!;
        await ctx.tx.orderItem.update({
          where: { id: it.id },
          data:
            l.delivered < l.ordered
              ? { orderedQty: l.ordered, quantity: it.quantity, discount: it.discount, cases: it.cases, deliveredQty: l.delivered, shortReason: l.reason }
              : { deliveredQty: l.delivered },
        });
      }
      await ctx.tx.order.update({
        where: { id: order.id },
        data: { grossAmount: r.grossAmount, discountAmount: r.discountAmount, subtotal: r.subtotal, gstAmount: r.gstAmount, totalAmount: r.totalAmount, orderedTotal: order.totalAmount },
      });
      totalAmount = r.totalAmount;
    } else {
      for (const l of lines) await ctx.tx.orderItem.update({ where: { id: l.item.id }, data: { deliveredQty: l.delivered } });
    }
    await bookSale(ctx, order.id, now);
  }

  const cashAmount = input.collect?.method === "CASH" ? input.collect.amount : 0;
  // Paid by the delivery QR (or a link) before handing over: online, collected.
  const paidOnline = !input.collect && (await ctx.tx.payment.count({ where: { orderId: order.id, method: "ONLINE", state: "CONFIRMED" } })) > 0;
  const deliveryData = {
    deliveredAt: now,
    state: "DELIVERED" as const,
    podPhotoUrl: input.pod.photo,
    podSignatureData: input.pod.signature,
    paymentMethod: paidOnline ? ("ONLINE" as const) : !input.collect ? ("CREDIT" as const) : input.collect.method === "CASH" ? ("CASH" as const) : ("ONLINE" as const),
    paymentStatus: input.collect || paidOnline ? ("COLLECTED" as const) : ("PENDING" as const),
    codAmount: cashAmount,
    lat: input.pod.lat,
    lng: input.pod.lng,
    accuracy: input.pod.accuracy,
    codeVerified: !!d?.code && !input.office,
    attempts: (d?.attempts ?? 0) + 1,
  };
  if (d) await ctx.tx.delivery.update({ where: { orderId: order.id }, data: deliveryData });
  else if (input.agentId) await ctx.tx.delivery.create({ data: { orderId: order.id, deliveryAgentId: input.agentId, seq: 1, ...deliveryData } });

  const note = input.office ? "Delivered at the office" : "Delivered with proof of delivery";
  const updated = await ctx.tx.order.update({
    where: { id: order.id },
    data: {
      status: "DELIVERED",
      statusEvents: { create: { status: "DELIVERED", actorId: ctx.actorId, note: short.length ? `${note}. Short: ${reasonText}` : note } },
    },
  });

  await recordReturnables(ctx, order.retailerId, input.returnables ?? [], { kind: "DELIVERY", tripId: d?.tripId ?? null, orderId: order.id });

  // Stock (Phase 5): what was handed over leaves the van (or the warehouse).
  await sellDelivered(
    ctx,
    order.id,
    lines.map((l) => ({ itemId: l.item.id, productId: l.item.productId, qty: l.delivered })),
    d?.tripId ?? null
  );

  // First good location fix for the shop becomes its map pin.
  if (order.retailer.lat === null && input.pod.lat !== null && input.pod.lng !== null && (input.pod.accuracy ?? 0) <= 100) {
    await ctx.tx.retailerProfile.update({ where: { id: order.retailerId }, data: { lat: input.pod.lat, lng: input.pod.lng } });
  }

  const { payment, invoice } = await onOrderDelivered(ctx, { ...order, totalAmount }, input.collect);
  return { order: updated, payment, invoice, creditNote, totalAmount };
}

/** The driver couldn't deliver: back to Packed for another trip. Invoices (if any) stay. */
export async function failDelivery(
  ctx: Ctx,
  orderId: string,
  f: { reason: FailReason | string; note?: string | null; lat?: number | null; lng?: number | null },
  now = new Date()
) {
  if (!isFailReason(f.reason)) throw new MoneyError("Pick a reason");
  const order = await ctx.tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { delivery: true } });
  if (order.status !== "OUT_FOR_DELIVERY" || !order.delivery || order.delivery.state !== "ASSIGNED") {
    throw new MoneyError("Only an order out for delivery can be marked not delivered");
  }
  const note = (f.note ?? "").trim().slice(0, 200) || null;
  if (f.reason === "other" && !note) throw new MoneyError("Write what happened");
  const label = FAIL_REASONS[f.reason];
  await ctx.tx.delivery.update({
    where: { orderId },
    data: { state: "FAILED", failReason: f.reason, failNote: note, failedAt: now, attempts: order.delivery.attempts + 1, lat: f.lat ?? null, lng: f.lng ?? null },
  });
  return ctx.tx.order.update({
    where: { id: orderId },
    data: { status: "PACKED", statusEvents: { create: { status: "PACKED", actorId: ctx.actorId, note: `Not delivered: ${label}${note ? ` (${note})` : ""}` } } },
  });
}

// ───────────────────────────── returnables ─────────────────────────────

export async function recordReturnables(
  ctx: Ctx,
  retailerId: string,
  rows: ReturnableInput[],
  at: { kind: "DELIVERY" | "PICKUP" | "OPENING" | "ADJUST"; tripId?: string | null; orderId?: string | null; note?: string | null; photoKey?: string | null }
) {
  const seen = new Set<string>();
  for (const r of rows) {
    const given = Number(r.given ?? 0);
    const taken = Number(r.taken ?? 0);
    if (![given, taken].every((n) => Number.isInteger(n) && n >= 0 && n <= 10_000)) throw new MoneyError("Crate counts must be whole numbers");
    if (given === 0 && taken === 0) continue;
    if (seen.has(r.returnableId)) throw new MoneyError("Each crate type can appear once");
    seen.add(r.returnableId);
    const ret = await ctx.tx.returnable.findUnique({ where: { id: r.returnableId } });
    if (!ret || (!ret.active && at.kind !== "ADJUST")) throw new MoneyError("That crate type isn't in use");
    await ctx.tx.returnableMove.create({
      data: {
        returnableId: ret.id,
        retailerId,
        kind: at.kind,
        given,
        taken,
        tripId: at.tripId ?? null,
        orderId: at.orderId ?? null,
        note: at.note ?? null,
        photoKey: at.photoKey ?? null,
        actorId: ctx.actorId,
      },
    });
  }
}

/** Crates / jars each retailer holds, per type. */
export async function returnableBalances(ctx: Ctx, retailerId?: string) {
  const rows = await ctx.tx.returnableMove.groupBy({
    by: ["retailerId", "returnableId"],
    where: retailerId ? { retailerId } : undefined,
    _sum: { given: true, taken: true },
  });
  return rows
    .map((r) => ({ retailerId: r.retailerId, returnableId: r.returnableId, balance: (r._sum.given ?? 0) - (r._sum.taken ?? 0) }))
    .filter((r) => r.balance !== 0);
}

/**
 * Bill the retailer for crates / jars they can't return (the type's unit
 * charge × units) and take those units off their balance.
 */
export async function chargeReturnables(ctx: Ctx, retailerId: string, returnableId: string, units: number, note?: string | null) {
  if (!Number.isInteger(units) || units < 1) throw new MoneyError("Units must be a whole number above zero");
  const ret = await ctx.tx.returnable.findUnique({ where: { id: returnableId } });
  if (!ret) throw new MoneyError("Crate type not found", 404);
  if (ret.unitCharge <= 0) throw new MoneyError(`Set a charge per ${ret.name} in Settings first`);
  const held = (await returnableBalances(ctx, retailerId)).find((b) => b.returnableId === returnableId)?.balance ?? 0;
  if (units > held) throw new MoneyError(`The shop holds only ${held} ${ret.name}`);
  const memo = `${units} × ${ret.name} not returned${note ? ` (${note.trim().slice(0, 100)})` : ""}`;
  const bill = await chargeDebit(ctx, { retailerId, amount: units * ret.unitCharge, kind: "PENALTY", note: memo });
  await ctx.tx.returnableMove.create({
    data: { returnableId, retailerId, kind: "CHARGE", taken: units, note: memo, billId: bill.id, actorId: ctx.actorId },
  });
  return bill;
}
