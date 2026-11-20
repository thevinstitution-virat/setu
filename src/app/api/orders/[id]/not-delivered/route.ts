import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { can } from "@/lib/permissions";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { failDelivery } from "@/lib/delivery";

/**
 * The driver couldn't deliver. Body: { reason (FAIL_REASONS key), note?, lat?, lng? }.
 * The order goes back to Packed for another trip; any invoice stays.
 * Allowed for the assigned driver, or office staff who can dispatch.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
  const delivery = await db.delivery.findUnique({ where: { orderId: id }, select: { deliveryAgentId: true } });
  const mine = !!agent && can(session.role, "delivery.work") && delivery?.deliveryAgentId === agent.id;
  if (!mine && !can(session.role, "orders.dispatch")) {
    return NextResponse.json({ error: "This order is not assigned to you" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  let order;
  try {
    order = await withMoney(tenant.id, session.userId, (ctx) =>
      failDelivery(ctx, id, {
        reason: String(body?.reason ?? ""),
        note: typeof body?.note === "string" ? body.note : null,
        lat: num(body?.lat),
        lng: num(body?.lng),
      })
    );
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: "order.not_delivered",
    entity: "Order",
    entityId: id,
    before: { status: "OUT_FOR_DELIVERY" },
    after: { status: "PACKED", reason: body?.reason ?? null, note: body?.note ?? null },
    ip: requestIp(req),
  });
  await emit("order.status", { tenantId: tenant.id, orderId: id, from: "OUT_FOR_DELIVERY", to: "PACKED" });
  return NextResponse.json({ order });
}
