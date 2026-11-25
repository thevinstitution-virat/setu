import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { CHEQUE_STATUS_LABEL, PAY_METHOD_LABEL, paymentDetail } from "@/lib/supplier-payments";
import { ErrorCard } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import { CancelPayment, ClearCheque } from "@/components/books/PaymentActions";

/** One payment to a supplier: how it was paid, the bills it settled, its cheque and bank line. */
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await booksPage((ctx) => paymentDetail(ctx, id));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const p = r.data;
  const cancelled = !!p.cancelledAt;

  return (
    <div className="space-y-4">
      <Link href="/admin/books/payments" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Payments
      </Link>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-kick">Payment to supplier</p>
            <h2 className="font-heading text-2xl font-bold text-[var(--ink)]">
              {p.number} {cancelled && <span className="chip !text-xs align-middle">{p.cheque?.status === "BOUNCED" ? "Cheque bounced" : "Cancelled"}</span>}
            </h2>
            <p className="text-sm text-[var(--ink-2)] mt-1">
              <Link href={`/admin/books/suppliers/${p.supplier.id}`} className="font-semibold text-[var(--accent-text)]">
                {p.supplier.name}
              </Link>{" "}
              · {showDay(p.date)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-heading text-2xl font-bold tabular-nums">{formatINR(p.amount)}</p>
            {p.tds > 0 && (
              <p className="text-xs text-[var(--muted)]">
                + TDS {formatINR(p.tds)} ({p.tdsSection})
              </p>
            )}
          </div>
        </div>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--muted)]">Paid by</dt>
            <dd>{PAY_METHOD_LABEL[p.method]}</dd>
          </div>
          {p.bankAccount && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">Our bank</dt>
              <dd>{p.bankAccount.name}</dd>
            </div>
          )}
          {p.reference && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">Reference</dt>
              <dd className="break-all">{p.reference}</dd>
            </div>
          )}
          {p.cheque && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">Cheque</dt>
              <dd>
                {p.cheque.number} dated {showDay(p.cheque.date.toISOString().slice(0, 10))} · {CHEQUE_STATUS_LABEL[p.cheque.status]}
              </dd>
            </div>
          )}
          {p.bankLine && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">On the bank statement</dt>
              <dd className="text-right">{p.bankLine.narration.slice(0, 60)}</dd>
            </div>
          )}
          {p.note && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">Note</dt>
              <dd>{p.note}</dd>
            </div>
          )}
          {cancelled && (
            <div className="flex justify-between gap-3">
              <dt className="text-[var(--muted)]">Why undone</dt>
              <dd>{p.cancelReason}</dd>
            </div>
          )}
        </dl>
        {!cancelled && r.me.canPay && (
          <div className="flex flex-wrap items-start gap-3 pt-1">
            {p.cheque?.status === "ISSUED" && <ClearCheque id={p.cheque.id} />}
            {p.cheque?.status !== "CLEARED" && <CancelPayment id={p.id} cheque={!!p.cheque} />}
          </div>
        )}
      </section>

      {!cancelled && (
        <section className="card p-4">
          <h3 className="font-heading font-bold text-[var(--ink)] mb-2">Bills it settled</h3>
          {p.allocations.length ? (
            <ul className="divide-y divide-[var(--line)] text-sm">
              {p.allocations.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-2">
                  <span>
                    {a.bill.purchaseBillId ? (
                      <Link href={`/admin/books/purchases/${a.bill.purchaseBillId}`} className="font-semibold text-[var(--accent-text)]">
                        {a.bill.number}
                      </Link>
                    ) : (
                      <span className="font-semibold">{a.bill.number}</span>
                    )}{" "}
                    <span className="text-[var(--muted)]">
                      {showDay(a.bill.date)} · bill {formatINR(a.bill.amount)}
                    </span>
                  </span>
                  <span className="tabular-nums font-semibold">{formatINR(a.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">None yet.</p>
          )}
          {p.advance > 0 && (
            <p className="text-sm mt-2">
              Kept as an advance: <span className="font-semibold tabular-nums">{formatINR(p.advance)}</span> (the next bill uses it)
            </p>
          )}
        </section>
      )}
    </div>
  );
}
