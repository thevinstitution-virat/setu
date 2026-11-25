import { formatINR } from "@/lib/money";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import OrderLines, { OrderMeta, isFreeLine } from "@/components/store/OrderLines";

export default async function SalesOrders() {
  const db = await getDb();
  const session = await getSession();
  const lang = await getServerLang();
  const agent = await db.salesAgentProfile.findUnique({ where: { userId: session!.userId } });

  const orders = agent
    ? await db.order.findMany({
        where: { retailer: { salesAgentId: agent.id } },
        orderBy: { createdAt: "desc" },
        include: { retailer: true, items: { include: { product: true } } },
      })
    : [];

  return (
    <div className="space-y-4">
      <h1 className="page-title">Orders from your retailers</h1>
      <div className="space-y-3">
        {orders.map((o) => {
          const free = o.items.filter(isFreeLine).length;
          return (
            <div key={o.id} className="card p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{o.retailer.outletName}</p>
                  <p className="text-xs text-foreground/50">
                    {o.orderNumber} · {o.items.length - free} items{free > 0 ? ` + ${free} free` : ""} · {formatINR(o.totalAmount)}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
                  {tr(`status.${o.status}`, lang)}
                </span>
              </div>
              <OrderMeta order={o} />
              <details className="group">
                <summary className="cursor-pointer text-xs font-bold text-[var(--accent-text)] list-none">
                  <span className="group-open:hidden">Show items</span>
                  <span className="hidden group-open:inline">Hide items</span>
                </summary>
                <div className="pt-3">
                  <OrderLines items={o.items} order={o} showMeta={false} />
                </div>
              </details>
            </div>
          );
        })}
        {orders.length === 0 && <p className="text-sm text-foreground/50">No orders yet.</p>}
      </div>
    </div>
  );
}
