"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { InvoicePanel } from "@/components/invoice/InvoiceView";

export type DeliveryInvoice = {
  id: string;
  type: "TAX_INVOICE" | "BILL_OF_SUPPLY" | "CREDIT_NOTE" | "DEBIT_NOTE";
  number: string;
  total: number;
  ewbNo: string | null;
  ewbVehicle: string | null;
  ewbValidUntil: string | null;
};

const LABEL: Record<DeliveryInvoice["type"], string> = {
  TAX_INVOICE: "Invoice",
  BILL_OF_SUPPLY: "Bill of supply",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
};

const shortDateTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** Phone-first invoice card for the delivery agent: number, total, PDF, and the share panel on demand. */
export default function DeliveryInvoiceCard({ invoices }: { invoices: DeliveryInvoice[] }) {
  const sale = invoices.find((i) => i.type === "TAX_INVOICE" || i.type === "BILL_OF_SUPPLY") ?? invoices[0];
  const notes = invoices.filter((i) => i.id !== sale.id);
  const [open, setOpen] = useState(false);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted)]">{LABEL[sale.type]}</p>
          <p className="font-bold break-all">{sale.number}</p>
        </div>
        <p className="font-bold text-lg shrink-0">{formatINR(sale.total)}</p>
      </div>

      {sale.ewbNo && (
        <p className="flex items-start gap-2 rounded-xl bg-black/[0.04] p-2.5 text-xs">
          <Icon name="truck" className="h-4 w-4 shrink-0 mt-px" />
          <span>
            E-way bill <b>{sale.ewbNo}</b>
            {sale.ewbVehicle ? `, vehicle ${sale.ewbVehicle}` : ""}
            {sale.ewbValidUntil ? `, valid till ${shortDateTime(sale.ewbValidUntil)}` : ""}
          </span>
        </p>
      )}

      {notes.length > 0 && (
        <ul className="text-xs text-[var(--muted)] space-y-0.5">
          {notes.map((n) => (
            <li key={n.id}>
              {LABEL[n.type]} {n.number}: {formatINR(n.total)}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <div className="space-y-3 border-t border-[var(--line)] pt-3">
          <InvoicePanel id={sale.id} />
          <button type="button" className="btn btn-quiet btn-sm w-full" onClick={() => setOpen(false)}>
            Hide invoice
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <a className="btn btn-outline btn-sm" href={`/api/invoices/${sale.id}/pdf`} target="_blank" rel="noopener">
            <Icon name="file" className="h-4 w-4" /> Open PDF
          </a>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
            <Icon name="share" className="h-4 w-4" /> Show &amp; share
          </button>
        </div>
      )}
    </div>
  );
}
