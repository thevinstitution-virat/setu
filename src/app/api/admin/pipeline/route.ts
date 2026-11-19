import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
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
  const auth = await guard("orders.view_all");
  if (!auth.ok) return auth.res;
  const { db } = auth;

  const counts = Object.fromEntries(
    await Promise.all(
      STATUSES.map(async (status) => [status, await db.order.count({ where: { status } })])
    )
  );

  const recentOrders = await db.order.findMany({
    take: 15,
    orderBy: { createdAt: "desc" },
    include: {
      retailer: { include: { user: true, area: true } },
      delivery: { omit: { code: true }, include: { deliveryAgent: { include: { user: true } } } },
    },
  });

  const [retailerCount, salesAgentCount, deliveryAgentCount, productCount] = await Promise.all([
    db.retailerProfile.count(),
    db.salesAgentProfile.count(),
    db.deliveryAgentProfile.count(),
    db.product.count(),
  ]);

  return NextResponse.json({
    counts,
    recentOrders,
    totals: { retailerCount, salesAgentCount, deliveryAgentCount, productCount },
  });
}
