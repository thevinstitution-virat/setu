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
import { SHORT_REASONS } from "@/lib/delivery-settings";
import { qtyLabel } from "@/components/store/format";

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

  // The code the driver asks for on high-value drops (only the retailer sees it).
  const code = order.status === "OUT_FOR_DELIVERY" && order.delivery?.code && !order.delivery.codeVerified ? order.delivery.code : null;
  // Delivered line by line: lines where less was handed over than ordered.
  const shortLines =
    order.status === "DELIVERED"
      ? order.items.filter((i) => i.deliveredQty !== null && i.deliveredQty !== (i.orderedQty ?? i.quantity))
      : [];

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

      {code && (
        <div className="panel-dark p-5 space-y-2">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Delivery code</p>
          <p className="font-heading font-bold text-5xl tracking-[0.25em]">{code}</p>
          <p className="text-sm text-white/80">Tell the driver this code when your goods arrive. Don&apos;t share it before.</p>
        </div>
      )}

      {shortLines.length > 0 && (
        <div className="card p-4 space-y-2">
          <p className="text-sm font-semibold">Delivered less than ordered</p>
          <ul className="divide-y divide-[var(--line)]">
            {shortLines.map((i) => {
              const reason = i.shortReason && i.shortReason in SHORT_REASONS ? SHORT_REASONS[i.shortReason as keyof typeof SHORT_REASONS] : null;
              return (
                <li key={i.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{i.product.name}</p>
                    {reason && <p className="text-xs text-[var(--muted)]">{reason}</p>}
                  </div>
                  <p className="text-xs text-right shrink-0">
                    <b>{qtyLabel(i.deliveredQty ?? 0, i.product.unit)}</b>
                    <br />
                    <span className="text-[var(--muted)]">of {i.orderedQty ?? i.quantity} ordered</span>
                  </p>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-[var(--muted)]">You pay only for what was delivered.</p>
        </div>
      )}

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
