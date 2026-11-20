import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getDb, requireTenant } from "@/lib/tenant";
import { supportSettings } from "@/lib/engage-settings";
import RateDelivery from "./RateDelivery";
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

const withinDays = (at: Date, days: number) => Date.now() - at.getTime() <= days * 24 * 3600_000;

export default async function RetailerOrderDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rate?: string; stars?: string }>;
}) {
  const db = await getDb();
  const { id } = await params;
  const sp = await searchParams;
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

  // Rating: delivered, not rated yet, and still inside the business's rating window.
  let rate: "open" | "rated" | null = null;
  let rated: { rating: number } | null = null;
  if (order.status === "DELIVERED") {
    rated = await db.deliveryFeedback.findUnique({ where: { orderId: order.id }, select: { rating: true } });
    const days = supportSettings((await requireTenant()).settings).feedbackDays;
    const at = order.delivery?.deliveredAt ?? order.updatedAt;
    rate = rated ? "rated" : withinDays(at, days) ? "open" : null;
  }
  const stars = Number(sp.stars);

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

      {rate === "open" && (
        <RateDelivery orderId={order.id} focus={sp.rate === "1"} stars={Number.isInteger(stars) ? stars : null} />
      )}
      {rate === "rated" && rated && (
        <p className="card p-3 text-sm flex items-center gap-2">
          <Icon name="star" className="h-4 w-4 text-[var(--genda)]" />
          You rated this delivery {rated.rating}/5. Thank you.
        </p>
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

      <Link
        href={`/retailer/help?new=1&order=${order.id}`}
        className="card p-4 flex items-center gap-3 hover:-translate-y-0.5 transition"
      >
        <span className="icon-tile bg-ink/5 text-[var(--ink-2)] shrink-0">
          <Icon name="chat" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-sm">Problem with this order?</span>
          <span className="block text-xs text-[var(--muted)]">Damaged, missing or wrong goods, or a bill problem</span>
        </span>
        <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </Link>
    </div>
  );
}
