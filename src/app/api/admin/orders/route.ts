import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import type { OrderStatus } from "@/generated/prisma/client";

export async function GET(req: Request) {
  const auth = await guard("orders.view_all");
  if (!auth.ok) return auth.res;
  const { db } = auth;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as OrderStatus | null;

  const orders = await db.order.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    include: {
      retailer: { include: { user: true, area: { include: { region: true } } } },
      items: { include: { product: true } },
      delivery: { include: { deliveryAgent: { include: { user: true } } } },
    },
  });

  return NextResponse.json({ orders });
}
