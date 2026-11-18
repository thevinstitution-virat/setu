import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import OrderTimeline from "@/components/OrderTimeline";
import OrderLines from "@/components/store/OrderLines";

export default async function RetailerOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const db = await getDb();
  const { id } = await params;
  const session = await getSession();
  const lang = await getServerLang();
  const profile = await db.retailerProfile.findUnique({ where: { userId: session!.userId } });

  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: true } },
      statusEvents: { orderBy: { createdAt: "asc" } },
      delivery: { include: { deliveryAgent: { include: { user: true } } } },
    },
  });

  if (!order || order.retailerId !== profile?.id) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{order.orderNumber}</h1>
          <p className="text-xs text-foreground/50">
            {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[order.status]}`}>
          {tr(`status.${order.status}`, lang)}
        </span>
      </div>

      {order.delivery?.deliveryAgent && (
        <div className="card p-4">
          <p className="text-xs text-foreground/50">Delivery agent</p>
          <p className="font-medium text-sm">{order.delivery.deliveryAgent.user.name}</p>
        </div>
      )}

      <div className="card p-4">
        <p className="text-sm font-semibold mb-3">Status</p>
        <OrderTimeline events={order.statusEvents} currentStatus={order.status} lang={lang} />
      </div>

      <div className="card p-4">
        <p className="text-sm font-semibold mb-3">Items</p>
        <OrderLines items={order.items} order={order} />
        {order.notes && <p className="text-xs text-[var(--muted)] mt-3">Note: {order.notes}</p>}
      </div>
    </div>
  );
}
