import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { STATUS_COLOR } from "@/lib/orders";
import { getServerLang, tr } from "@/lib/i18n/server";
import OrderTimeline from "@/components/OrderTimeline";
import OrderLines from "@/components/store/OrderLines";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";

const DOC_LABEL = {
  TAX_INVOICE: "Invoice",
  BILL_OF_SUPPLY: "Bill of supply",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
} as const;

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

  const invoices = await db.invoice.findMany({
    where: { orderId: order.id },
    orderBy: { date: "asc" },
    select: { id: true, type: true, number: true, total: true },
  });

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

      {invoices.length > 0 && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Invoice</p>
            <Link href="/retailer/invoices" className="text-xs font-semibold text-[var(--kesar-text)]">
              All invoices
            </Link>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {invoices.map((inv) => {
              const note = inv.type === "CREDIT_NOTE" || inv.type === "DEBIT_NOTE";
              return (
                <li key={inv.id} className="py-2 flex items-center justify-between gap-3">
                  <Link href={`/retailer/invoices/${inv.id}`} className="min-w-0 flex-1">
                    <p className="text-sm font-semibold break-all">{inv.number}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {DOC_LABEL[inv.type]} · {inv.type === "CREDIT_NOTE" ? "− " : ""}
                      {formatINR(inv.total)}
                    </p>
                  </Link>
                  <a
                    href={`/api/invoices/${inv.id}/pdf`}
                    target="_blank"
                    rel="noopener"
                    className={`btn btn-sm shrink-0 ${note ? "btn-outline" : "btn-primary"}`}
                  >
                    <Icon name="file" className="h-4 w-4" /> Open PDF
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
