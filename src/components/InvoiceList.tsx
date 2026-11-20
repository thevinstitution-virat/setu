import Link from "next/link";
import { formatINR } from "@/lib/money";
import type { TenantDb } from "@/lib/db";

/**
 * Plain list of invoices / notes for the retailer and sales-agent screens.
 * Server-safe (no "use client"): the shared invoice helpers in
 * components/invoice/InvoiceView are client-only references on the server.
 */

export type InvoiceRow = {
  id: string;
  type: "TAX_INVOICE" | "BILL_OF_SUPPLY" | "CREDIT_NOTE" | "DEBIT_NOTE";
  number: string;
  date: Date | string;
  total: number;
  /** Unpaid on this document's bill, paise; null when it has no bill (credit notes). */
  due: number | null;
  order?: { orderNumber: string } | null;
  original?: { number: string } | null;
};

export const DOC_LABEL: Record<InvoiceRow["type"], string> = {
  TAX_INVOICE: "Invoice",
  BILL_OF_SUPPLY: "Bill of supply",
  CREDIT_NOTE: "Credit note",
  DEBIT_NOTE: "Debit note",
};

const CHIP: Record<InvoiceRow["type"], string> = {
  TAX_INVOICE: "chip chip-mor",
  BILL_OF_SUPPLY: "chip chip-mor",
  CREDIT_NOTE: "chip chip-mint",
  DEBIT_NOTE: "chip chip-genda",
};

export const docDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Unpaid amount per bill number (an invoice's bill carries the invoice number). */
export async function dueByNumber(db: TenantDb, numbers: string[]) {
  if (numbers.length === 0) return new Map<string, number>();
  const bills = await db.bill.findMany({ where: { number: { in: numbers } }, select: { number: true, amount: true, paid: true } });
  return new Map(bills.map((b) => [b.number, b.amount - b.paid]));
}

export default function InvoiceList({ rows, hrefBase, empty = "No invoices yet." }: { rows: InvoiceRow[]; hrefBase: string; empty?: string }) {
  if (rows.length === 0) return <div className="card p-4 text-sm text-[var(--muted)]">{empty}</div>;
  return (
    <div className="card divide-y divide-[var(--line)]">
      {rows.map((r) => {
        const credit = r.type === "CREDIT_NOTE";
        return (
          <Link key={r.id} href={`${hrefBase}/${r.id}`} className="p-4 flex items-start justify-between gap-3 hover:bg-black/[0.02]">
            <div className="min-w-0">
              <p className="font-bold text-sm break-all">{r.number}</p>
              <p className="text-xs text-[var(--muted)] mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className={CHIP[r.type]}>{DOC_LABEL[r.type]}</span>
                <span>{docDate(r.date)}</span>
              </p>
              {(r.order || r.original) && (
                <p className="text-xs text-[var(--muted)] mt-1">
                  {r.original ? `Against ${r.original.number}` : `Order ${r.order!.orderNumber}`}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p className={`font-bold ${credit ? "text-[var(--mint-text)]" : ""}`}>
                {credit ? "− " : ""}
                {formatINR(r.total)}
              </p>
              {credit ? (
                <p className="text-xs text-[var(--muted)] mt-1">Less from dues</p>
              ) : r.due === null ? null : r.due > 0 ? (
                <p className="text-xs font-semibold text-[var(--kesar-text)] mt-1">Due {formatINR(r.due)}</p>
              ) : (
                <p className="text-xs font-semibold text-[var(--mint-text)] mt-1">Paid</p>
              )}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
