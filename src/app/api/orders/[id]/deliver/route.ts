import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "DELIVERY_AGENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const agent = await prisma.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const delivery = await prisma.delivery.findUnique({ where: { orderId: id } });
  if (!delivery || delivery.deliveryAgentId !== agent.id) {
    return NextResponse.json({ error: "This order is not assigned to you" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const { podPhotoUrl, podSignatureData, paymentMethod, codAmount, lat, lng } = body ?? {};

  await prisma.delivery.update({
    where: { orderId: id },
    data: {
      deliveredAt: new Date(),
      podPhotoUrl,
      podSignatureData,
      paymentMethod: paymentMethod ?? "CASH",
      paymentStatus: "COLLECTED",
      codAmount: codAmount ?? 0,
      lat,
      lng,
    },
  });

  const order = await prisma.order.update({
    where: { id },
    data: {
      status: "DELIVERED",
      statusEvents: {
        create: { status: "DELIVERED", actorId: session.userId, note: "Delivered with proof of delivery" },
      },
    },
  });

  return NextResponse.json({ order });
}
