import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { ledgerHref } from "@/lib/books";
import { DOC_LABEL, supplierDetail, SUPPLIER_KINDS } from "@/lib/purchases";
import { stateLabel } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import SupplierEditor from "@/components/books/SupplierEditor";
import OpeningSupplierBills from "@/components/books/OpeningSupplierBills";
import { PAY_METHOD_LABEL } from "@/lib/pay-labels";

const CREDIT_LABEL: Record<string, string> = { DEBIT_NOTE: "Our debit note", CREDIT_NOTE: "Their credit note", OPENING_ADVANCE: "Advance (old books)", PAYMENT: "Payment", TDS: "TDS kept back" };

/** One supplier: what we owe, open bills, unused notes and advances, documents and the statement. */
export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await booksPage(async (ctx) => ({
    ...(await supplierDetail(ctx, id)),
    payments: await ctx.tx.supplierPayment.findMany({
      where: { supplierId: id },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 20,
      select: { id: true, number: true, date: true, method: true, amount: true, tds: true, cancelledAt: true, cheque: { select: { number: true, status: true } } },
    }),
  }));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { supplier: s, summary, bills, credits, docs, hasOpening, account, payments } = r.data;
  const statement = ledgerHref(account);

  return (
    <div className="space-y-4">
      <Link href="/admin/books/suppliers" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Suppliers
      </Link>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-kick">{SUPPLIER_KINDS[s.kind]}</p>
            <h2 className="font-heading text-2xl font-bold text-[var(--ink)] break-words">
              {s.name} {!s.active && <span className="chip !text-xs align-middle">Not in use</span>}
            </h2>
            <p className="text-sm text-[var(--ink-2)] mt-1">
              {[s.gstin ? `GSTIN ${s.gstin}` : null, s.pan ? `PAN ${s.pan}` : null, stateLabel(s.stateCode), `${s.creditDays} days' credit`, s.tdsSection ? `TDS ${s.tdsSection}` : null].filter(Boolean).join(" · ")}
            </p>
            <p className="text-xs text-[var(--muted)] mt-0.5">
              {[s.contactName, s.phone, s.email, s.bankName && s.bankAccountNo ? `${s.bankName} ····${s.bankAccountNo.slice(-4)} ${s.bankIfsc ?? ""}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          {r.me.canPurchase && (
            <SupplierEditor
              buttonLabel="Edit"
              buttonClass="btn btn-outline btn-xs"
              initial={{
                id: s.id,
                name: s.name,
                kind: s.kind,
                gstin: s.gstin ?? "",
                stateCode: s.stateCode ?? "",
                pan: s.pan ?? "",
                contactName: s.contactName ?? "",
                phone: s.phone ?? "",
                email: s.email ?? "",
                address: s.address ?? "",
                creditDays: String(s.creditDays),
                bankName: s.bankName ?? "",
                bankIfsc: s.bankIfsc ?? "",
                bankAccountNo: s.bankAccountNo ?? "",
                tdsSection: s.tdsSection ?? "",
                active: s.active,
              }}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {r.me.canPay && s.active && (
            <Link className="btn btn-mor btn-xs" href={`/admin/books/payments/new?supplier=${s.id}`}>
              <Icon name="rupee" className="h-3.5 w-3.5" /> Pay
            </Link>
          )}
          {s.kind === "GOODS" && (
            <Link className="btn btn-outline btn-xs" href={`/admin/books/claims?supplier=${s.id}`}>
              <Icon name="receipt" className="h-3.5 w-3.5" /> Claims
            </Link>
          )}
          {r.me.canPurchase && s.active && (
            <>
              <Link className="btn btn-outline btn-xs" href={`/admin/books/purchases/new?supplier=${s.id}`}>
                <Icon name="plus" className="h-3.5 w-3.5" /> Purchase bill
              </Link>
              <Link className="btn btn-outline btn-xs" href={`/admin/books/purchases/new?type=DEBIT_NOTE&supplier=${s.id}`}>
                Debit note
              </Link>
              <Link className="btn btn-outline btn-xs" href={`/admin/books/purchases/new?type=CREDIT_NOTE&supplier=${s.id}`}>
                Credit note
              </Link>
            </>
          )}
          <Link className="btn btn-outline btn-xs" href={statement}>
            <Icon name="file" className="h-3.5 w-3.5" /> Statement
          </Link>
          <Link className="btn btn-outline btn-xs" href={`/admin/books/purchases?supplier=${s.id}`}>
            Purchase register
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={summary.owed >= 0 ? "We owe them" : "Paid ahead"} value={formatINR(Math.abs(summary.owed))} />
        <Kpi label="Open bills" value={String(summary.openBills)} />
        <Kpi label="Past due" value={formatINR(summary.overdue)} />
        <Kpi label="Notes and advances not yet used" value={formatINR(summary.unused)} />
      </div>

      <section className="card p-0 overflow-x-auto">
        <h3 className="font-heading font-bold text-[var(--ink)] px-4 pt-4">Open bills</h3>
        {bills.length ? (
          <table className="w-full text-sm mt-2" style={{ minWidth: 620 }}>
            <thead>
              <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                <th className="px-4 py-2 text-left font-semibold">Their bill</th>
                <th className="px-4 py-2 text-left font-semibold">Date</th>
                <th className="px-4 py-2 text-left font-semibold">Due</th>
                <th className="px-4 py-2 text-right font-semibold">Amount</th>
                <th className="px-4 py-2 text-right font-semibold">Settled</th>
                <th className="px-4 py-2 text-right font-semibold">To pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {bills.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2">
                    {b.purchaseBillId ? (
                      <Link href={`/admin/books/purchases/${b.purchaseBillId}`} className="font-semibold text-[var(--accent-text)]">
                        {b.number}
                      </Link>
                    ) : (
                      <span className="font-semibold">{b.number}</span>
                    )}
                    {b.kind === "OPENING" && <span className="chip !text-[10px] ml-1">Old books</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{showDay(b.date)}</td>
                  <td className={`px-4 py-2 whitespace-nowrap ${b.overdue ? "text-[var(--risk-text)] font-semibold" : ""}`}>{showDay(b.dueDate)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatINR(b.amount)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.paid ? formatINR(b.paid) : ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatINR(b.left)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-4">
            <Empty>No open bills.</Empty>
          </div>
        )}
      </section>

      {credits.length > 0 && (
        <section className="card p-4">
          <h3 className="font-heading font-bold text-[var(--ink)] mb-2">Notes and advances not yet set against a bill</h3>
          <ul className="divide-y divide-[var(--line)] text-sm">
            {credits.map((c) => (
              <li key={c.id} className="flex justify-between gap-3 py-2">
                <span>
                  {c.purchaseBillId ? (
                    <Link href={`/admin/books/purchases/${c.purchaseBillId}`} className="font-semibold text-[var(--accent-text)]">
                      {c.number}
                    </Link>
                  ) : (
                    <span className="font-semibold">{c.number}</span>
                  )}{" "}
                  <span className="text-[var(--muted)]">
                    {CREDIT_LABEL[c.kind] ?? c.kind} · {showDay(c.date)}
                  </span>
                </span>
                <span className="tabular-nums font-semibold">{formatINR(c.left)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h3 className="font-heading font-bold text-[var(--ink)] mb-2">Recent bills and notes</h3>
        {docs.length ? (
          <ul className="divide-y divide-[var(--line)] text-sm">
            {docs.map((d) => (
              <li key={d.id} className={`flex justify-between gap-3 py-2 ${d.cancelled ? "opacity-50" : ""}`}>
                <span className="min-w-0">
                  <Link href={`/admin/books/purchases/${d.id}`} className="font-semibold text-[var(--accent-text)]">
                    {d.number}
                  </Link>{" "}
                  <span className="text-[var(--muted)]">
                    {DOC_LABEL[d.type]} {d.supplierRef} · {showDay(d.date)}
                    {d.cancelled ? " · cancelled" : ""}
                  </span>
                </span>
                <span className="tabular-nums">{formatINR(d.total)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No purchase bills or notes yet.</Empty>
        )}
      </section>

      <section className="card p-4">
        <h3 className="font-heading font-bold text-[var(--ink)] mb-2">Payments to them</h3>
        {payments.length ? (
          <ul className="divide-y divide-[var(--line)] text-sm">
            {payments.map((p) => (
              <li key={p.id} className={`flex justify-between gap-3 py-2 ${p.cancelledAt ? "opacity-50" : ""}`}>
                <span className="min-w-0">
                  <Link href={`/admin/books/payments/${p.id}`} className="font-semibold text-[var(--accent-text)]">
                    {p.number}
                  </Link>{" "}
                  <span className="text-[var(--muted)]">
                    {PAY_METHOD_LABEL[p.method]}
                    {p.cheque ? ` ${p.cheque.number}${p.cheque.status === "ISSUED" ? " (not yet cleared)" : ""}` : ""} · {showDay(p.date.toISOString().slice(0, 10))}
                    {p.cancelledAt ? (p.cheque?.status === "BOUNCED" ? " · bounced" : " · cancelled") : ""}
                    {p.tds ? ` · TDS ${formatINR(p.tds)}` : ""}
                  </span>
                </span>
                <span className="tabular-nums">{formatINR(p.amount)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No payments to them yet.</Empty>
        )}
      </section>

      {r.me.canSetup && !hasOpening && <OpeningSupplierBills supplierId={s.id} name={s.name} />}
    </div>
  );
}
