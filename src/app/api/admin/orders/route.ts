import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import type { OrderStatus } from "@/generated/prisma/client";

/** Never send password hashes or other account internals to the browser. */
const USER = { id: true, name: true, phone: true } as const;

const STATUSES: OrderStatus[] = ["PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

export async function GET(req: Request) {
  const auth = await guard("orders.view_all");
  if (!auth.ok) return auth.res;
  const { db } = auth;

  const url = new URL(req.url);
  // An unknown status lists every order instead of failing the query.
  const raw = url.searchParams.get("status");
  const status = raw && (STATUSES as string[]).includes(raw) ? (raw as OrderStatus) : null;

  const [orders, byStatus] = await Promise.all([
    db.order.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: "desc" },
      include: {
        retailer: { include: { user: { select: USER }, area: { include: { region: true } } } },
        items: { include: { product: true } },
        delivery: { omit: { code: true }, include: { deliveryAgent: { include: { user: { select: USER } } } } },
        // The sale invoice (tax invoice or bill of supply), once issued.
        invoices: { where: { type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } }, select: { id: true, number: true }, take: 1 },
      },
    }),
    // How many orders each status has, for the page's tabs.
    db.order.groupBy({ by: ["status"], _count: true }),
  ]);

  const counts = Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((g) => g.status === s)?._count ?? 0]));
  return NextResponse.json({ orders, counts });
}
