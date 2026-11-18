import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function DeliveryHistory() {
  const session = await getSession();
  const agent = await prisma.deliveryAgentProfile.findUnique({ where: { userId: session!.userId } });

  const deliveries = agent
    ? await prisma.delivery.findMany({
        where: { deliveryAgentId: agent.id, order: { status: "DELIVERED" } },
        include: { order: { include: { retailer: true } } },
        orderBy: { deliveredAt: "desc" },
      })
    : [];

  return (
    <div className="space-y-4">
      <h1 className="page-title">Delivery history</h1>
      <div className="space-y-3">
        {deliveries.map((d) => (
          <div key={d.id} className="card p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{d.order.retailer.outletName}</p>
              <p className="text-xs text-foreground/50">
                {d.order.orderNumber} · ₹{d.order.totalAmount.toFixed(2)} · {d.paymentMethod}
              </p>
            </div>
            <span className="text-xs text-foreground/50">
              {d.deliveredAt && new Date(d.deliveredAt).toLocaleString()}
            </span>
          </div>
        ))}
        {deliveries.length === 0 && (
          <p className="text-sm text-foreground/50">No deliveries completed yet.</p>
        )}
      </div>
    </div>
  );
}
