import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import type { OrderStatus } from "@/generated/prisma/client";

/** Never send password hashes or other account internals to the browser. */
const USER = { id: true, name: true, phone: true } as const;

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
      retailer: { include: { user: { select: USER }, area: { include: { region: true } } } },
      items: { include: { product: true } },
      delivery: { omit: { code: true }, include: { deliveryAgent: { include: { user: { select: USER } } } } },
      // The sale invoice (tax invoice or bill of supply), once issued.
      invoices: { where: { type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } }, select: { id: true, number: true }, take: 1 },
    },
  });

  return NextResponse.json({ orders });
}
