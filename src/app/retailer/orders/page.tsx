import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";

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
      <h1 className="page-title">Your orders</h1>
      {orders.length === 0 && (
        <p className="text-sm text-foreground/50">No orders placed yet.</p>
      )}
      <div className="space-y-3">
        {orders.map((o) => (
          <Link key={o.id} href={`/retailer/orders/${o.id}`} className="card p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">{o.orderNumber}</p>
              <p className="text-xs text-foreground/50">
                {o.items.length} items · {formatINR(o.totalAmount)} ·{" "}
                {new Date(o.createdAt).toLocaleDateString()}
              </p>
            </div>
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
              {tr(`status.${o.status}`, lang)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
