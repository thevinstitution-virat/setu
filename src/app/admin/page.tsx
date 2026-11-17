import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import type { OrderStatus } from "@/generated/prisma/client";

const STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export default async function AdminPipeline() {
  const lang = await getServerLang();
  const [counts, recentOrders, retailerCount, salesAgentCount, deliveryAgentCount, productCount] =
    await Promise.all([
      Promise.all(STATUSES.map((s) => prisma.order.count({ where: { status: s } }))),
      prisma.order.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          retailer: { include: { user: true, area: true } },
          delivery: { include: { deliveryAgent: { include: { user: true } } } },
        },
      }),
      prisma.retailerProfile.count(),
      prisma.salesAgentProfile.count(),
      prisma.deliveryAgentProfile.count(),
      prisma.product.count(),
    ]);

  const countByStatus = Object.fromEntries(STATUSES.map((s, i) => [s, counts[i]]));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Pipeline overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUSES.filter((s) => s !== "CANCELLED").map((s) => (
          <div key={s} className="card p-4">
            <p className="text-2xl font-semibold">{countByStatus[s]}</p>
            <p className="text-xs text-foreground/50">{tr(`status.${s}`, lang)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Retailers" value={retailerCount} />
        <StatCard label="Sales agents" value={salesAgentCount} />
        <StatCard label="Delivery agents" value={deliveryAgentCount} />
        <StatCard label="Active products" value={productCount} />
      </div>

      <div className="card">
        <div className="flex items-center justify-between p-4 border-b border-black/5">
          <p className="font-semibold text-sm">Recent orders</p>
          <Link href="/admin/orders" className="text-sm text-brand-dark font-medium">
            View all →
          </Link>
        </div>
        <div className="divide-y divide-black/5">
          {recentOrders.map((o) => (
            <div key={o.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium">{o.retailer.outletName}</p>
                <p className="text-xs text-foreground/50">
                  {o.orderNumber} · {o.retailer.area.name} · ₹{o.totalAmount.toFixed(2)}
                  {o.delivery?.deliveryAgent && ` · ${o.delivery.deliveryAgent.user.name}`}
                </p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
                {tr(`status.${o.status}`, lang)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-foreground/50">{label}</p>
    </div>
  );
}
