import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import { formatDay } from "@/components/store/format";
import { isFreeLine } from "@/components/store/OrderLines";
import Icon from "@/components/Icon";

export default async function RetailerOrders() {
  const db = await getDb();
  const session = await getSession();
  const lang = await getServerLang();
  const profile = await db.retailerProfile.findUnique({ where: { userId: session!.userId } });
  const orders = profile
    ? await db.order.findMany({
        where: { retailerId: profile.id },
        orderBy: { createdAt: "desc" },
        include: { items: true },
      })
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="page-title">Your orders</h1>
        <Link href="/retailer/invoices" className="btn btn-quiet btn-sm shrink-0">
          <Icon name="file" className="h-4 w-4" /> My invoices
        </Link>
      </div>
      {orders.length === 0 && (
        <p className="text-sm text-foreground/50">No orders placed yet.</p>
      )}
      <div className="space-y-3">
        {orders.map((o) => {
          const free = o.items.filter(isFreeLine).length;
          return (
          <Link key={o.id} href={`/retailer/orders/${o.id}`} className="card p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-sm">{o.orderNumber}</p>
              <p className="text-xs text-foreground/50">
                {o.items.length - free} items{free > 0 ? ` + ${free} free` : ""} · {formatINR(o.totalAmount)} ·{" "}
                {new Date(o.createdAt).toLocaleDateString()}
              </p>
              {(o.deliveryDate || o.discountAmount > 0) && (
                <p className="text-xs mt-0.5">
                  {o.deliveryDate && <span className="text-[var(--ink-2)]">Delivery {formatDay(o.deliveryDate)}</span>}
                  {o.deliveryDate && o.discountAmount > 0 && " · "}
                  {o.discountAmount > 0 && (
                    <span className="font-semibold text-[var(--mint-text)]">Saved {formatINR(o.discountAmount)}</span>
                  )}
                </p>
              )}
            </div>
            <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
              {tr(`status.${o.status}`, lang)}
            </span>
          </Link>
          );
        })}
      </div>
    </div>
  );
}
