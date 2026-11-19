import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getDb } from "@/lib/tenant";
import { STATUS_COLOR, STATUS_TILE } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import type { OrderStatus } from "@/generated/prisma/client";
import Icon, { type IconName } from "@/components/Icon";
import StockAlertStrip from "@/components/stock/overview/StockAlertStrip";

const STATUSES: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export default async function AdminPipeline() {
  const db = await getDb();
  const lang = await getServerLang();
  const [counts, recentOrders, retailerCount, salesAgentCount, deliveryAgentCount, productCount] =
    await Promise.all([
      Promise.all(STATUSES.map((s) => db.order.count({ where: { status: s } }))),
      db.order.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
        include: {
          retailer: { include: { user: true, area: true } },
          delivery: { include: { deliveryAgent: { include: { user: true } } } },
        },
      }),
      db.retailerProfile.count(),
      db.salesAgentProfile.count(),
      db.deliveryAgentProfile.count(),
      db.product.count(),
    ]);

  const countByStatus = Object.fromEntries(STATUSES.map((s, i) => [s, counts[i]]));

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <p className="page-kick">Owner&apos;s dashboard</p>
          <h1 className="page-title">Pipeline overview</h1>
          <p className="page-sub">Every order at every stage, without a phone call.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/reports" className="btn btn-outline btn-sm">
            Reports
          </Link>
          <Link href="/admin/orders" className="btn btn-kesar btn-sm">
            Manage orders <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="card p-3 sm:p-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {STATUSES.filter((s) => s !== "CANCELLED").map((s) => (
            <div key={s} className={`rounded-2xl p-4 border border-[var(--line)] ${STATUS_TILE[s]}`}>
              <p className="stat-num">{countByStatus[s]}</p>
              <p className="stat-lbl">{tr(`status.${s}`, lang)}</p>
            </div>
          ))}
        </div>
      </div>

      <StockAlertStrip />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon="users" tint="kesar" label="Retailers" value={retailerCount} />
        <StatCard icon="route" tint="mor" label="Sales agents" value={salesAgentCount} />
        <StatCard icon="truck" tint="genda" label="Delivery agents" value={deliveryAgentCount} />
        <StatCard icon="tag" tint="mint" label="Active products" value={productCount} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-[var(--line)]">
          <p className="font-heading font-bold">Recent orders</p>
          <Link href="/admin/orders" className="text-sm text-[var(--kesar-text)] font-bold">
            View all →
          </Link>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {recentOrders.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">{o.retailer.outletName}</p>
                <p className="text-xs text-[var(--muted)] truncate">
                  {o.orderNumber} · {o.retailer.area.name} · {formatINR(o.totalAmount)}
                  {o.delivery?.deliveryAgent && ` · ${o.delivery.deliveryAgent.user.name}`}
                </p>
              </div>
              <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
                {tr(`status.${o.status}`, lang)}
              </span>
            </div>
          ))}
          {recentOrders.length === 0 && (
            <p className="px-4 py-6 text-sm text-[var(--muted)]">No orders yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const TINTS = {
  kesar: "bg-[var(--kesar-tint)] text-[var(--kesar-text)]",
  mor: "bg-[#e1eeec] text-mor",
  genda: "bg-[var(--genda-tint)] text-[var(--genda-text)]",
  mint: "bg-[var(--mint-tint)] text-[var(--mint-text)]",
};

function StatCard({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: number;
  icon: IconName;
  tint: keyof typeof TINTS;
}) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <span className={`icon-tile ${TINTS[tint]}`}>
        <Icon name={icon} />
      </span>
      <div>
        <p className="stat-num !text-2xl">{value}</p>
        <p className="stat-lbl !mt-1">{label}</p>
      </div>
    </div>
  );
}
