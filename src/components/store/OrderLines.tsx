import { formatINR, lineMoney } from "@/lib/money";
import { formatDay, qtyLabel } from "./format";

/**
 * Items and totals of a placed order, as frozen at order time. No hooks, so
 * it renders in server pages and client pages alike. Free goods (price 0 with
 * a scheme) are shown as FREE; `freeCallout` lists them in a box of their own
 * so the delivery agent hands them over.
 */

export type OrderLineItem = {
  id: string;
  quantity: number;
  price: number;
  gstRate: number;
  discount?: number | null;
  mrp?: number | null;
  cases?: number | null;
  caseSize?: number | null;
  freeSchemeId?: string | null;
  /** Scheme the office typed on this line, paise (already in discount). */
  extraScheme?: number | null;
  /** Deal the office typed on this line (dealGet free for every dealBuy). */
  dealBuy?: number | null;
  dealGet?: number | null;
  /** Free goods from the office's deal on that line. */
  dealForItemId?: string | null;
  product: { name: string; unit?: string | null; caseUnit?: string | null };
};

export type OrderTotals = {
  grossAmount?: number | null;
  discountAmount?: number | null;
  deliveryCharge?: number | null;
  subtotal?: number | null;
  gstAmount: number;
  totalAmount: number;
  couponCode?: string | null;
  deliveryDate?: string | Date | null;
  /** Item rates include GST. */
  taxInclusive?: boolean | null;
};

/** Free goods: a scheme's gift or the office's deal (price 0). */
export const isFreeLine = (i: Pick<OrderLineItem, "price" | "freeSchemeId" | "dealForItemId">) => i.price === 0 && (!!i.freeSchemeId || !!i.dealForItemId);

/** Line value after scheme discount, with GST. inclusive: the rate already includes GST. */
export function lineTotal(i: OrderLineItem, inclusive = false): number {
  return lineMoney(i.price, i.quantity, i.discount ?? 0, i.gstRate, inclusive).total;
}

export function OrderMeta({ order }: { order: Pick<OrderTotals, "couponCode" | "deliveryDate"> }) {
  if (!order.deliveryDate && !order.couponCode) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {order.deliveryDate && <span className="chip chip-mint">Delivery {formatDay(order.deliveryDate)}</span>}
      {order.couponCode && <span className="chip chip-genda">Coupon {order.couponCode}</span>}
    </div>
  );
}

export default function OrderLines({
  items,
  order,
  freeCallout = false,
  showMeta = true,
}: {
  items: OrderLineItem[];
  order: OrderTotals;
  freeCallout?: boolean;
  showMeta?: boolean;
}) {
  const paid = items.filter((i) => !isFreeLine(i));
  const free = items.filter(isFreeLine);
  const gross = order.grossAmount ?? 0;
  const discount = order.discountAmount ?? 0;
  const delivery = order.deliveryCharge ?? 0;

  return (
    <div className="space-y-3">
      {showMeta && <OrderMeta order={order} />}

      {freeCallout && free.length > 0 && (
        <div className="rounded-xl bg-[var(--mint-tint)] p-3 space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--mint-text)]">
            Free goods: hand these over too
          </p>
          {free.map((i) => (
            <p key={i.id} className="flex items-center justify-between gap-3 text-sm font-semibold text-[var(--mint-text)]">
              <span className="min-w-0 break-words">{i.product.name}</span>
              <span className="shrink-0">{qtyLabel(i.quantity, i.product.unit)}</span>
            </p>
          ))}
        </div>
      )}

      <div className="divide-y divide-[var(--line)]">
        {paid.map((i) => (
          <div key={i.id} className="py-2 first:pt-0 flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium break-words">{i.product.name}</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {qtyLabel(i.quantity, i.product.unit, i.cases, i.caseSize, i.product.caseUnit)} · {formatINR(i.price)}
                {i.product.unit ? ` / ${i.product.unit}` : ""}
                {i.gstRate > 0 && (order.taxInclusive ? ` · incl. GST ${i.gstRate}%` : ` · GST ${i.gstRate}%`)}
              </p>
              {(i.discount ?? 0) > 0 && (
                <p className="text-xs font-semibold text-[var(--mint-text)] mt-0.5">
                  Scheme discount −{formatINR(i.discount!)}
                  {(i.extraScheme ?? 0) > 0 && (i.extraScheme ?? 0) < i.discount! ? ` (incl. ${formatINR(i.extraScheme!)} added by the office)` : ""}
                </p>
              )}
              {i.dealBuy && i.dealGet ? (
                <p className="text-xs font-semibold text-[var(--mint-text)] mt-0.5">
                  Deal {i.dealBuy}+{i.dealGet}
                  {i.cases ? " (cases)" : ""}
                </p>
              ) : null}
            </div>
            <span className="shrink-0 font-semibold">{formatINR(lineTotal(i, !!order.taxInclusive))}</span>
          </div>
        ))}
        {!freeCallout &&
          free.map((i) => (
            <div key={i.id} className="py-2 flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium break-words">{i.product.name}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">
                  {qtyLabel(i.quantity, i.product.unit)} · {i.dealForItemId ? "deal" : "scheme gift"}
                </p>
              </div>
              <span className="chip chip-mint shrink-0">FREE</span>
            </div>
          ))}
      </div>

      <div className="border-t border-[var(--line)] pt-3 space-y-1 text-sm">
        {gross > 0 ? (
          <Row label="Goods" value={formatINR(gross)} />
        ) : (
          order.subtotal != null && <Row label="Subtotal" value={formatINR(order.subtotal)} />
        )}
        {discount > 0 && <Row label="Scheme discount" value={`−${formatINR(discount)}`} tone="mint" />}
        {delivery > 0 && <Row label="Delivery charge" value={formatINR(delivery)} />}
        {order.gstAmount > 0 && <Row label="GST" value={formatINR(order.gstAmount)} />}
        <div className="flex justify-between font-bold pt-1">
          <span>Total</span>
          <span>{formatINR(order.totalAmount)}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "mint" }) {
  return (
    <div className={`flex justify-between ${tone === "mint" ? "text-[var(--mint-text)] font-semibold" : "text-[var(--ink-2)]"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
