import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { OrderStatus } from "@/generated/prisma/client";

const STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const counts = Object.fromEntries(
    await Promise.all(
      STATUSES.map(async (status) => [status, await prisma.order.count({ where: { status } })])
    )
  );

  const recentOrders = await prisma.order.findMany({
    take: 15,
    orderBy: { createdAt: "desc" },
    include: {
      retailer: { include: { user: true, area: true } },
      delivery: { include: { deliveryAgent: { include: { user: true } } } },
    },
  });

  const [retailerCount, salesAgentCount, deliveryAgentCount, productCount] = await Promise.all([
    prisma.retailerProfile.count(),
    prisma.salesAgentProfile.count(),
    prisma.deliveryAgentProfile.count(),
    prisma.product.count(),
  ]);

  return NextResponse.json({
    counts,
    recentOrders,
    totals: { retailerCount, salesAgentCount, deliveryAgentCount, productCount },
  });
}
