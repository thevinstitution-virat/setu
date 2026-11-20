import { formatINR } from "@/lib/money";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { FAIL_REASONS } from "@/lib/delivery-settings";
import Link from "next/link";

const failLabel = (r: string | null) => (r && r in FAIL_REASONS ? FAIL_REASONS[r as keyof typeof FAIL_REASONS] : "No reason");
const when = (d: Date | null) =>
  d ? d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "";

export default async function DeliveryHistory() {
  const db = await getDb();
  const session = await getSession();
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session!.userId } });

  const [deliveries, failed] = agent
    ? await Promise.all([
        db.delivery.findMany({
          where: { deliveryAgentId: agent.id, order: { status: "DELIVERED" } },
          include: {
            order: {
              include: {
                retailer: true,
                items: { select: { quantity: true, orderedQty: true, deliveredQty: true } },
                invoices: { select: { type: true, total: true } },
              },
            },
          },
          orderBy: { deliveredAt: "desc" },
        }),
        // Stops still marked not delivered (the order waits for another trip).
        db.delivery.findMany({
          where: { deliveryAgentId: agent.id, state: "FAILED" },
          include: { order: { include: { retailer: true } } },
          orderBy: { failedAt: "desc" },
          take: 30,
        }),
      ])
    : [[], []];

  const rows = [
    ...deliveries.map((d) => ({ kind: "done" as const, at: d.deliveredAt, d })),
    ...failed.map((d) => ({ kind: "failed" as const, at: d.failedAt, d })),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  return (
    <div className="space-y-4">
      <h1 className="page-title">Delivery history</h1>
      <div className="space-y-3">
        {rows.map((row) => {
          if (row.kind === "failed") {
            const d = row.d;
            return (
              <div key={d.id} className="card p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm break-words">{d.order.retailer.outletName}</p>
                  <p className="text-xs text-foreground/50">
                    {d.order.orderNumber} · {formatINR(d.order.totalAmount)}
                  </p>
                  <p className="text-xs font-semibold text-[#a8281e] mt-0.5">Not delivered: {failLabel(d.failReason)}</p>
                </div>
                <span className="text-xs text-foreground/50 shrink-0">{when(d.failedAt)}</span>
              </div>
            );
          }
          const d = row.d;
          // Net of short-delivery credit notes when the order was invoiced at dispatch.
          const sale = d.order.invoices.find((i) => i.type === "TAX_INVOICE" || i.type === "BILL_OF_SUPPLY");
          const credited = d.order.invoices.filter((i) => i.type === "CREDIT_NOTE").reduce((a, i) => a + i.total, 0);
          const amount = sale ? sale.total - credited : d.order.totalAmount;
          const short = d.order.items.filter((i) => i.deliveredQty !== null && i.deliveredQty < (i.orderedQty ?? i.quantity)).length;
          return (
            <Link key={d.id} href={`/delivery/orders/${d.order.id}`} className="card p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm break-words">{d.order.retailer.outletName}</p>
                <p className="text-xs text-foreground/50">
                  {d.order.orderNumber} · {formatINR(amount)} · {d.paymentMethod}
                </p>
                {short > 0 && (
                  <p className="text-xs font-semibold text-[var(--kesar-text)] mt-0.5">
                    Short: {short} line{short === 1 ? "" : "s"}
                  </p>
                )}
              </div>
              <span className="text-xs text-foreground/50 shrink-0">{when(d.deliveredAt)}</span>
            </Link>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-foreground/50">No deliveries completed yet.</p>}
      </div>
    </div>
  );
}
