import Link from "next/link";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STATUS_COLOR, ORDER_STATUS_FLOW } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";

export default async function RetailerHome() {
  const session = await getSession();
  const lang = await getServerLang();
  const profile = await prisma.retailerProfile.findUnique({
    where: { userId: session!.userId },
    include: { area: { include: { region: true } } },
  });

  const latestOrder = profile
    ? await prisma.order.findFirst({
        where: { retailerId: profile.id },
        orderBy: { createdAt: "desc" },
        include: { items: { include: { product: true } }, delivery: { include: { deliveryAgent: { include: { user: true } } } } },
      })
    : null;

  const orderCount = profile ? await prisma.order.count({ where: { retailerId: profile.id } }) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Welcome, {profile?.outletName}</h1>
        <p className="text-sm text-foreground/60">
          {profile?.area.name}, {profile?.area.region.name}
        </p>
      </div>

      {latestOrder ? (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-foreground/60">Latest order</p>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[latestOrder.status]}`}>
              {tr(`status.${latestOrder.status}`, lang)}
            </span>
          </div>
          <p className="font-medium">{latestOrder.orderNumber}</p>
          <p className="text-sm text-foreground/60">
            {latestOrder.items.length} item{latestOrder.items.length !== 1 ? "s" : ""} · ₹
            {latestOrder.totalAmount.toFixed(2)}
          </p>

          {latestOrder.status !== "CANCELLED" && (
            <ol className="flex items-center gap-1 pt-1">
              {ORDER_STATUS_FLOW.map((s, i) => {
                const reached = ORDER_STATUS_FLOW.indexOf(latestOrder.status) >= i;
                return (
                  <li key={s} className="flex-1 flex flex-col items-center gap-1">
                    <div className={`h-1.5 w-full rounded-full ${reached ? "bg-brand" : "bg-black/10"}`} />
                  </li>
                );
              })}
            </ol>
          )}

          {latestOrder.delivery?.deliveryAgent && (
            <p className="text-xs text-foreground/60">
              Delivery by {latestOrder.delivery.deliveryAgent.user.name}
            </p>
          )}

          <Link
            href={`/retailer/orders/${latestOrder.id}`}
            className="inline-block text-sm font-medium text-brand-dark"
          >
            View full timeline →
          </Link>
        </div>
      ) : (
        <div className="card p-6 text-center space-y-2">
          <p className="text-foreground/70">You haven&apos;t placed an order yet.</p>
          <Link href="/retailer/catalogue" className="text-brand-dark font-medium text-sm">
            Browse the catalogue →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/retailer/catalogue" className="card p-4 flex flex-col gap-1">
          <span className="text-2xl">🛒</span>
          <span className="font-medium text-sm">New order</span>
        </Link>
        <Link href="/retailer/orders" className="card p-4 flex flex-col gap-1">
          <span className="text-2xl">📦</span>
          <span className="font-medium text-sm">{orderCount} total orders</span>
        </Link>
      </div>
    </div>
  );
}
