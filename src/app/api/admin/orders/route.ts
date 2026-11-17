import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { OrderStatus } from "@/generated/prisma/client";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as OrderStatus | null;

  const orders = await prisma.order.findMany({
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
