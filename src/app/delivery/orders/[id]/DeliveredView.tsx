"use client";

import Link from "next/link";
import { qtyLabel } from "@/components/store/format";
import Icon from "@/components/Icon";
import DeliveryInvoiceCard, { type DeliveryInvoice } from "./DeliveryInvoiceCard";
import { orderedOf, shortReasonLabel } from "./deliver-model";
import type { OrderDetail } from "./DeliverOrder";

/** After delivery: what was short, the invoice to show / share, and the way back to the stops. */
export default function DeliveredView({ order, invoices }: { order: OrderDetail; invoices: DeliveryInvoice[] }) {
  const short = order.items.filter((i) => i.deliveredQty !== null && i.deliveredQty < orderedOf(i));
  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">{order.retailer.outletName}</h1>
        <p className="text-sm text-foreground/50">{order.orderNumber}</p>
      </div>
      <p className="flex items-center gap-2 rounded-xl bg-[var(--success-tint)] text-[var(--success-text)] p-3 text-sm font-bold">
        <Icon name="check" className="h-4 w-4" /> Delivered
      </p>

      {short.length > 0 && (
        <div className="card p-4 space-y-2">
          <p className="text-sm font-semibold">
            Short on {short.length} line{short.length === 1 ? "" : "s"}
          </p>
          <ul className="divide-y divide-[var(--line)]">
            {short.map((i) => (
              <li key={i.id} className="py-2 text-sm">
                <p className="font-medium break-words">{i.product.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {i.deliveredQty} of {qtyLabel(orderedOf(i), i.product.unit)}
                  {shortReasonLabel(i.shortReason) ? ` · ${shortReasonLabel(i.shortReason)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {invoices.length > 0 ? (
        <DeliveryInvoiceCard invoices={invoices} />
      ) : (
        <p className="text-sm text-[var(--muted)]">The invoice will show here once it is ready.</p>
      )}
      <Link href="/delivery" className="btn btn-kesar w-full !min-h-[52px]">
        Back to my stops <Icon name="arrow" className="h-4 w-4" />
      </Link>
    </div>
  );
}
