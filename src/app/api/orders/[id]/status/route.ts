import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { emit } from "@/lib/jobs";
import { audit, requestIp } from "@/lib/audit";
import { nextStatus } from "@/lib/orders";
import type { OrderStatus } from "@/generated/prisma/client";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("orders.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action as "advance" | "cancel" | undefined;

  const order = await db.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let newStatus: OrderStatus | null = null;
  if (action === "cancel") {
    newStatus = "CANCELLED";
  } else {
    newStatus = nextStatus(order.status);
  }

  if (!newStatus) {
    return NextResponse.json({ error: "No further status transition available" }, { status: 400 });
  }

  const updated = await db.order.update({
    where: { id },
    data: {
      status: newStatus,
      statusEvents: { create: { status: newStatus, actorId: session.userId, note: body?.note } },
    },
  });

  await audit(db, { actorId: session.userId, action: "order.status", entity: "Order", entityId: id, before: { status: order.status }, after: { status: newStatus, note: body?.note }, ip: requestIp(req) });

  await emit("order.status", { tenantId: auth.tenant.id, orderId: id, from: order.status, to: newStatus });

  return NextResponse.json({ order: updated });
}
