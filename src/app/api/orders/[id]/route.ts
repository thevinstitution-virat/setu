import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";

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
      retailer: { include: { user: true, area: { include: { region: true } } } },
      items: { include: { product: true } },
      statusEvents: { orderBy: { createdAt: "asc" }, include: { actor: true } },
      delivery: { include: { deliveryAgent: { include: { user: true } } } },
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
    if (!agent || order.retailer.salesAgentId !== agent.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
