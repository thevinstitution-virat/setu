import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";

export default async function SalesOrders() {
  const session = await getSession();
  const lang = await getServerLang();
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session!.userId } });

  const orders = agent
    ? await prisma.order.findMany({
        where: { retailer: { salesAgentId: agent.id } },
        orderBy: { createdAt: "desc" },
        include: { retailer: true, items: true },
      })
    : [];

  return (
    <div className="space-y-4">
      <h1 className="page-title">Orders from your retailers</h1>
      <div className="space-y-3">
        {orders.map((o) => (
          <div key={o.id} className="card p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{o.retailer.outletName}</p>
              <p className="text-xs text-foreground/50">
                {o.orderNumber} · {o.items.length} items · ₹{o.totalAmount.toFixed(2)}
              </p>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
              {tr(`status.${o.status}`, lang)}
            </span>
          </div>
        ))}
        {orders.length === 0 && <p className="text-sm text-foreground/50">No orders yet.</p>}
      </div>
    </div>
  );
}
