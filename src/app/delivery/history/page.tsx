import { formatINR } from "@/lib/money";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";

export default async function DeliveryHistory() {
  const db = await getDb();
  const session = await getSession();
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session!.userId } });

  const deliveries = agent
    ? await db.delivery.findMany({
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
                {d.order.orderNumber} · {formatINR(d.order.totalAmount)} · {d.paymentMethod}
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
