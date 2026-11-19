import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { emit } from "@/lib/jobs";
import { audit, requestIp } from "@/lib/audit";
import { nextStatus } from "@/lib/orders";
import { can } from "@/lib/permissions";
import { creditCancelledOrder, MoneyError, onOrderCancelled, onOrderDispatched, withMoney } from "@/lib/ledger";
import { queueEInvoice } from "@/lib/einvoice-queue";
import { moneyFail } from "@/lib/money-api";
import { releaseRedemptions } from "@/lib/order-place";
import type { OrderStatus } from "@/generated/prisma/client";

/**
 * action: "advance" (next status), "cancel", or "approve_credit" (release an
 * order held for credit; needs credit.manage). Delivery is not done here —
 * it goes through /deliver so the sale is billed.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("orders.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = (body?.action ?? "advance") as "advance" | "cancel" | "approve_credit";
  const note = typeof body?.note === "string" ? body.note.slice(0, 300) : undefined;

  if (action === "approve_credit" && !can(session.role, "credit.manage")) {
    return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  }

  let result: { from: OrderStatus; to: OrderStatus | null; order: unknown; docs?: { id: string; einvStatus: string }[] };
  try {
    result = await withMoney(tenant.id, session.userId, async (ctx) => {
      const order = await ctx.tx.order.findUnique({ where: { id } });
      if (!order) throw new MoneyError("Not found", 404);

      if (action === "approve_credit") {
        if (!order.creditHold || order.creditApprovedAt) throw new MoneyError("This order is not on credit hold", 409);
        const updated = await ctx.tx.order.update({
          where: { id },
          data: { creditApprovedBy: session.userId, creditApprovedAt: new Date() },
        });
        return { from: order.status, to: null, order: updated };
      }

      let to: OrderStatus | null;
      if (action === "cancel") {
        if (order.status === "DELIVERED") throw new MoneyError("A delivered order can't be cancelled. Issue a credit note instead.");
        if (order.status === "CANCELLED") throw new MoneyError("Already cancelled", 409);
        to = "CANCELLED";
      } else {
        if (order.creditHold && !order.creditApprovedAt) {
          throw new MoneyError(`On credit hold: ${order.creditHoldReason ?? "needs approval"}`, 409);
        }
        to = nextStatus(order.status);
        if (to === "DELIVERED") throw new MoneyError("Mark it delivered from the delivery screen so it is billed");
      }
      if (!to) throw new MoneyError("No further status transition available");

      const docs: { id: string; einvStatus: string }[] = [];
      if (to === "CANCELLED") {
        // Already invoiced (at dispatch): a credit note cancels the sale.
        const cn = await creditCancelledOrder(ctx, order.id, note || "Order cancelled");
        if (cn) docs.push(cn);
        await onOrderCancelled(ctx, order);
        await releaseRedemptions(ctx.tx, order.id);
      }
      if (to === "OUT_FOR_DELIVERY") {
        const inv = await onOrderDispatched(ctx, order.id);
        if (inv) docs.push(inv);
      }
      const updated = await ctx.tx.order.update({
        where: { id },
        data: { status: to, statusEvents: { create: { status: to, actorId: session.userId, note } } },
      });
      return { from: order.status, to, order: updated, docs };
    });
  } catch (e) {
    return moneyFail(e);
  }

  if (action === "approve_credit") {
    await audit(db, { actorId: session.userId, action: "order.credit_approve", entity: "Order", entityId: id, after: { note }, ip: requestIp(req) });
  } else {
    await audit(db, { actorId: session.userId, action: "order.status", entity: "Order", entityId: id, before: { status: result.from }, after: { status: result.to, note }, ip: requestIp(req) });
    await emit("order.status", { tenantId: tenant.id, orderId: id, from: result.from, to: result.to });
    for (const d of result.docs ?? []) await queueEInvoice(tenant.id, d);
  }
  return NextResponse.json({ order: result.order });
}
