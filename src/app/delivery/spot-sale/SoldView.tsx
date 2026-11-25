"use client";

import Link from "next/link";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import DeliveryInvoiceCard, { type DeliveryInvoice } from "../orders/[id]/DeliveryInvoiceCard";

export type SoldSale = {
  orderNumber: string;
  shopName: string;
  total: number;
  /** Paise collected and how; null = on credit. */
  collected: { amount: number; method: string } | null;
  invoices: DeliveryInvoice[];
};

const METHOD: Record<string, string> = { CASH: "cash", UPI: "UPI", CHEQUE: "cheque" };

/** After the sale: order number, total, what was collected, the invoice to show / share, and the ways on. */
export default function SoldView({ sale, onNewAction }: { sale: SoldSale; onNewAction: () => void }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Spot sale</p>
        <h1 className="page-title">{sale.shopName}</h1>
        <p className="text-sm text-[var(--muted)] break-all">{sale.orderNumber}</p>
      </div>
      <p className="flex items-center gap-2 rounded-xl bg-[var(--success-tint)] text-[var(--success-text)] p-3 text-sm font-bold">
        <Icon name="check" className="h-4 w-4" /> Sold and delivered
      </p>

      <div className="card p-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted)]">Total</p>
          <p className="text-sm text-[var(--ink-2)] mt-0.5">
            {sale.collected
              ? `${formatINR(sale.collected.amount)} collected in ${METHOD[sale.collected.method] ?? sale.collected.method.toLowerCase()}`
              : "On credit: added to the shop's khata"}
          </p>
        </div>
        <p className="font-heading font-bold text-2xl shrink-0">{formatINR(sale.total)}</p>
      </div>

      {sale.invoices.length > 0 ? (
        <DeliveryInvoiceCard invoices={sale.invoices} />
      ) : (
        <p className="text-sm text-[var(--muted)]">The invoice will show here once it is ready.</p>
      )}

      <div className="space-y-3">
        <button type="button" className="btn btn-kesar w-full !min-h-[52px]" onClick={onNewAction}>
          <Icon name="plus" className="h-4 w-4" /> New spot sale
        </button>
        <Link href="/delivery" className="btn btn-outline w-full">
          Back to trip <Icon name="arrow" className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
