import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const deliveryAgentId = body?.deliveryAgentId as string | undefined;
  if (!deliveryAgentId) {
    return NextResponse.json({ error: "deliveryAgentId is required" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({ where: { id }, include: { delivery: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.status === "DELIVERED" || order.status === "CANCELLED") {
    return NextResponse.json({ error: "Order can no longer be assigned" }, { status: 400 });
  }

  await prisma.delivery.upsert({
    where: { orderId: id },
    update: { deliveryAgentId },
    create: { orderId: id, deliveryAgentId },
  });

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: "OUT_FOR_DELIVERY",
      statusEvents: {
        create: { status: "OUT_FOR_DELIVERY", actorId: session.userId, note: "Assigned for delivery" },
      },
    },
  });

  return NextResponse.json({ order: updated });
}
