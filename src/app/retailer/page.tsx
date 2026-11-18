import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { STATUS_COLOR, ORDER_STATUS_FLOW } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import Icon from "@/components/Icon";

export default async function RetailerHome() {
  const db = await getDb();
  const session = await getSession();
  const lang = await getServerLang();
  const profile = await db.retailerProfile.findUnique({
    where: { userId: session!.userId },
    include: { area: { include: { region: true } } },
  });

  const latestOrder = profile
    ? await db.order.findFirst({
        where: { retailerId: profile.id },
        orderBy: { createdAt: "desc" },
        include: { items: { include: { product: true } }, delivery: { include: { deliveryAgent: { include: { user: true } } } } },
      })
    : null;

  const orderCount = profile ? await db.order.count({ where: { retailerId: profile.id } }) : 0;
  const reachedIdx = latestOrder ? ORDER_STATUS_FLOW.indexOf(latestOrder.status) : -1;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-kick">Welcome</p>
        <h1 className="page-title">{profile?.outletName}</h1>
        <p className="page-sub">
          {profile?.area.name}, {profile?.area.region.name}
        </p>
      </div>

      {latestOrder ? (
        <div className="panel-dark p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Latest order</p>
              <p className="font-heading font-bold text-xl mt-1">{latestOrder.orderNumber}</p>
              <p className="text-sm text-white/70 mt-0.5">
                {latestOrder.items.length} item{latestOrder.items.length !== 1 ? "s" : ""} · {formatINR(latestOrder.totalAmount)}
              </p>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[latestOrder.status]}`}>
              {tr(`status.${latestOrder.status}`, lang)}
            </span>
          </div>

          {latestOrder.status !== "CANCELLED" && (
            <ol className="grid grid-cols-5 gap-1.5">
              {ORDER_STATUS_FLOW.map((s, i) => {
                const reached = reachedIdx >= i;
                const done = latestOrder.status === "DELIVERED";
                return (
                  <li key={s} className="flex flex-col gap-1.5">
                    <div
                      className={`h-1.5 rounded-full ${
                        reached ? (done ? "bg-[var(--mint)]" : "bg-[var(--kesar)]") : "bg-white/15"
                      }`}
                    />
                    <span className={`text-[10.5px] leading-tight font-semibold ${reached ? "text-white/85" : "text-white/40"}`}>
                      {tr(`status.${s}`, lang)}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            {latestOrder.delivery?.deliveryAgent ? (
              <p className="text-xs text-white/70 flex items-center gap-1.5">
                <Icon name="truck" className="h-4 w-4 text-genda" />
                Delivery by {latestOrder.delivery.deliveryAgent.user.name}
              </p>
            ) : (
              <span />
            )}
            <Link href={`/retailer/orders/${latestOrder.id}`} className="btn btn-kesar btn-sm">
              View timeline <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="card p-6 text-center space-y-3">
          <p className="text-[var(--ink-2)]">You haven&apos;t placed an order yet.</p>
          <Link href="/retailer/catalogue" className="btn btn-kesar btn-sm">
            Browse the catalogue <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/retailer/catalogue" className="card p-4 flex flex-col gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
            <Icon name="cart" />
          </span>
          <span>
            <span className="block font-bold text-sm">New order</span>
            <span className="block text-xs text-[var(--muted)] mt-0.5">From the catalogue</span>
          </span>
        </Link>
        <Link href="/retailer/orders" className="card p-4 flex flex-col gap-3 hover:-translate-y-0.5 transition">
          <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
            <Icon name="box" />
          </span>
          <span>
            <span className="block stat-num !text-2xl">{orderCount}</span>
            <span className="block text-xs text-[var(--muted)] mt-1">Total orders</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
