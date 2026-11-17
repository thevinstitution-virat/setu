import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const order = await prisma.order.findUnique({
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
    const profile = await prisma.retailerProfile.findUnique({ where: { userId: session.userId } });
    if (profile?.id !== order.retailerId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (session.role === "SALES_AGENT") {
    const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent || order.retailer.salesAgentId !== agent.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (session.role === "DELIVERY_AGENT") {
    const agent = await prisma.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent || order.delivery?.deliveryAgentId !== agent.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ order });
}
