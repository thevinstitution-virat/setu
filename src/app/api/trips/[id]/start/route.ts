import { NextResponse } from "next/server";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { queueEInvoice } from "@/lib/einvoice-queue";
import { startTrip } from "@/lib/trips";
import { tripAuth } from "@/lib/trip-api";
import { can } from "@/lib/permissions";

/**
 * The trip leaves: every stop goes out for delivery (and is invoiced when the
 * business invoices at dispatch). Dispatch staff, or the trip's driver.
 * With stock tracking, the van is topped up to carry every order. Body
 * { stockOverride: true } (stock staff only) loads even when the warehouse
 * records are short, correcting them.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id, { driver: true });
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => null);
  const stockOverride = body?.stockOverride === true && can(a.session.role, "stock.manage");
  let out;
  try {
    out = await withMoney(a.tenant.id, a.session.userId, (ctx) => startTrip(ctx, id, new Date(), { stockOverride }));
  } catch (e) {
    return moneyFail(e);
  }
  for (const d of out.docs) await queueEInvoice(a.tenant.id, d);
  for (const orderId of out.orderIds) {
    await emit("order.status", { tenantId: a.tenant.id, orderId, from: "PACKED", to: "OUT_FOR_DELIVERY" });
  }
  // For Phase 7 notifications (ETA message to each retailer).
  await emit("trip.started", { tenantId: a.tenant.id, tripId: id, orderIds: out.orderIds });
  await audit(a.db, { actorId: a.session.userId, action: "trip.start", entity: "Trip", entityId: id, after: { stops: out.orderIds.length, invoiced: out.docs.length }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, stops: out.orderIds.length, invoiced: out.docs.length });
}
