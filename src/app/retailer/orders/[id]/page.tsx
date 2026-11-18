import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import OrderTimeline from "@/components/OrderTimeline";

export default async function RetailerOrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const lang = await getServerLang();
  const profile = await prisma.retailerProfile.findUnique({ where: { userId: session!.userId } });

  const order = await prisma.order.findUnique({
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
        <div className="space-y-2">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>
                {item.product.name} × {item.quantity}
                {item.gstRate > 0 && (
                  <span className="text-foreground/40"> (GST {item.gstRate}%)</span>
                )}
              </span>
              <span>₹{(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-black/5 mt-3 pt-3 space-y-1">
          <div className="flex justify-between text-sm text-foreground/60">
            <span>{tr("pricing.subtotal", lang)}</span>
            <span>₹{order.subtotal.toFixed(2)}</span>
          </div>
          {order.gstAmount > 0 && (
            <div className="flex justify-between text-sm text-foreground/60">
              <span>{tr("pricing.gst", lang)}</span>
              <span>₹{order.gstAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-sm">
            <span>{tr("pricing.total", lang)}</span>
            <span>₹{order.totalAmount.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
