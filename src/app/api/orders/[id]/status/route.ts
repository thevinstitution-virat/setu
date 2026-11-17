import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { nextStatus } from "@/lib/orders";
import type { OrderStatus } from "@/generated/prisma/client";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action as "advance" | "cancel" | undefined;

  const order = await prisma.order.findUnique({ where: { id } });
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

  const updated = await prisma.order.update({
    where: { id },
    data: {
      status: newStatus,
      statusEvents: { create: { status: newStatus, actorId: session.userId, note: body?.note } },
    },
  });

  return NextResponse.json({ order: updated });
}
