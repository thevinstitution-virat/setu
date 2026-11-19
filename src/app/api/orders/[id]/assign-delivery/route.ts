import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { MoneyError, onOrderDispatched, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { queueEInvoice } from "@/lib/einvoice-queue";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("orders.dispatch");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const deliveryAgentId = body?.deliveryAgentId as string | undefined;
  if (!deliveryAgentId) {
    return NextResponse.json({ error: "deliveryAgentId is required" }, { status: 400 });
  }

  // Foreign keys are not filtered by row-level security, so check the agent is ours.
  const agentRow = await db.deliveryAgentProfile.findUnique({ where: { id: deliveryAgentId }, include: { user: { select: { active: true } } } });
  if (!agentRow || !agentRow.user.active) {
    return NextResponse.json({ error: "Delivery agent not found" }, { status: 404 });
  }

  const order = await db.order.findUnique({ where: { id }, include: { delivery: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.status === "DELIVERED" || order.status === "CANCELLED") {
    return NextResponse.json({ error: "Order can no longer be assigned" }, { status: 400 });
  }
  if (order.creditHold && !order.creditApprovedAt) {
    return NextResponse.json(
      { error: `On credit hold: ${order.creditHoldReason ?? "needs approval"}` },
      { status: 409 }
    );
  }

  // Assign, move to out-for-delivery and (when invoicing at dispatch) issue the
  // invoice and book the sale — all or nothing.
  let updated, invoice;
  try {
    ({ updated, invoice } = await withMoney(auth.tenant.id, session.userId, async (ctx) => {
      const fresh = await ctx.tx.order.findUniqueOrThrow({ where: { id } });
      if (fresh.status === "DELIVERED" || fresh.status === "CANCELLED") throw new MoneyError("Order can no longer be assigned");
      await ctx.tx.delivery.upsert({
        where: { orderId: id },
        update: { deliveryAgentId },
        create: { orderId: id, deliveryAgentId },
      });
      const statusChange =
        fresh.status === "OUT_FOR_DELIVERY"
          ? {}
          : { status: "OUT_FOR_DELIVERY" as const, statusEvents: { create: { status: "OUT_FOR_DELIVERY" as const, actorId: session.userId, note: "Assigned for delivery" } } };
      const updated = await ctx.tx.order.update({ where: { id }, data: statusChange });
      const invoice = await onOrderDispatched(ctx, id);
      return { updated, invoice };
    }));
  } catch (e) {
    return moneyFail(e);
  }
  if (invoice) await queueEInvoice(auth.tenant.id, invoice);

  await audit(db, { actorId: session.userId, action: "order.assign", entity: "Order", entityId: id, before: { status: order.status, deliveryAgentId: order.delivery?.deliveryAgentId ?? null }, after: { status: "OUT_FOR_DELIVERY", deliveryAgentId }, ip: requestIp(req) });
  await emit("order.status", { tenantId: auth.tenant.id, orderId: id, from: order.status, to: "OUT_FOR_DELIVERY" });

  return NextResponse.json({ order: updated });
}
