import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DeliveryHome() {
  const session = await getSession();
  const agent = await prisma.deliveryAgentProfile.findUnique({ where: { userId: session!.userId } });

  const deliveries = agent
    ? await prisma.delivery.findMany({
        where: { deliveryAgentId: agent.id, order: { status: "OUT_FOR_DELIVERY" } },
        include: { order: { include: { retailer: true, items: true } } },
        orderBy: { assignedAt: "asc" },
      })
    : [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Assigned deliveries</h1>
      <div className="space-y-3">
        {deliveries.map((d) => (
          <Link
            key={d.id}
            href={`/delivery/orders/${d.order.id}`}
            className="card p-4 flex items-center justify-between"
          >
            <div>
              <p className="font-medium text-sm">{d.order.retailer.outletName}</p>
              <p className="text-xs text-foreground/50">
                {d.order.orderNumber} · {d.order.items.length} items · ₹
                {d.order.totalAmount.toFixed(2)}
              </p>
            </div>
            <span className="text-brand-dark text-sm font-medium">Deliver →</span>
          </Link>
        ))}
        {deliveries.length === 0 && (
          <p className="text-sm text-foreground/50">No deliveries assigned right now.</p>
        )}
      </div>
    </div>
  );
}
