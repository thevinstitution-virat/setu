import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import Icon from "@/components/Icon";

export default async function DeliveryHome() {
  const db = await getDb();
  const session = await getSession();
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session!.userId } });

  const deliveries = agent
    ? await db.delivery.findMany({
        where: { deliveryAgentId: agent.id, order: { status: "OUT_FOR_DELIVERY" } },
        include: { order: { include: { retailer: true, items: true } } },
        orderBy: { assignedAt: "asc" },
      })
    : [];

  const toCollect = deliveries.reduce((sum, d) => sum + d.order.totalAmount, 0);

  return (
    <div className="space-y-6">
      <div>
        <p className="page-kick">On the road</p>
        <h1 className="page-title">Assigned deliveries</h1>
      </div>

      <div className="panel-dark p-5 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Drops left</p>
          <p className="stat-num mt-2">{deliveries.length}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Order value</p>
          <p className="stat-num mt-2">{formatINR(toCollect, { whole: true })}</p>
        </div>
      </div>

      <div className="space-y-3">
        {deliveries.map((d, i) => (
          <Link
            key={d.id}
            href={`/delivery/orders/${d.order.id}`}
            className="card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition"
          >
            <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)] font-heading font-bold">
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{d.order.retailer.outletName}</p>
              <p className="text-xs text-[var(--muted)] truncate">
                {d.order.orderNumber} · {d.order.items.length} items · {formatINR(d.order.totalAmount)}
              </p>
            </div>
            <span className="btn btn-kesar btn-xs">
              Deliver <Icon name="arrow" className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
        {deliveries.length === 0 && (
          <div className="card p-6 text-center">
            <span className="icon-tile mx-auto mb-3 bg-[var(--mint-tint)] text-[var(--mint-text)]">
              <Icon name="check" />
            </span>
            <p className="text-sm text-[var(--ink-2)]">No deliveries assigned right now.</p>
          </div>
        )}
      </div>
    </div>
  );
}
