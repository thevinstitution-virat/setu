import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";

const USER = { id: true, name: true, phone: true } as const;
const PRODUCT_PUBLIC = { omit: { lastCost: true, supplierId: true, reorderLevel: true, reorderQty: true, visibleAreaIds: true, visibleGroupIds: true } } as const;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;

  const order = await db.order.findUnique({
    where: { id },
    include: {
      retailer: { include: { user: { select: USER }, area: { include: { region: true } } } },
      items: { include: { product: PRODUCT_PUBLIC } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, name: true, role: true } } } },
      delivery: { include: { deliveryAgent: { include: { user: { select: USER } } } } },
    },
  });

  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (session.role === "RETAILER") {
    const profile = await db.retailerProfile.findUnique({ where: { userId: session.userId } });
    if (profile?.id !== order.retailerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (session.role === "SALES_AGENT") {
    const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent || (order.retailer.salesAgentId !== agent.id && order.placedById !== session.userId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (session.role === "SUPERVISOR") {
    const placer = order.placedById ? await db.user.findUnique({ where: { id: order.placedById }, select: { id: true, supervisorId: true } }) : null;
    const agentUser = order.retailer.salesAgentId ? await db.salesAgentProfile.findUnique({ where: { id: order.retailer.salesAgentId }, select: { user: { select: { id: true, supervisorId: true } } } }) : null;
    const mine = (u: { id: string; supervisorId: string | null } | null | undefined) => !!u && (u.id === session.userId || u.supervisorId === session.userId);
    if (!mine(placer) && !mine(agentUser?.user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (session.role === "DELIVERY_AGENT") {
    const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent || order.delivery?.deliveryAgentId !== agent.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // The delivery code proves the retailer received the goods: only the
  // retailer (and dispatch staff) may see it, never the driver.
  if (order.delivery) {
    const showCode = session.role === "RETAILER" || can(session.role, "orders.dispatch");
    const { code, ...rest } = order.delivery;
    const delivery = { ...rest, codeNeeded: !!code && !rest.codeVerified, code: showCode ? code : null };
    return NextResponse.json({ order: { ...order, delivery } });
  }
  return NextResponse.json({ order });
}
