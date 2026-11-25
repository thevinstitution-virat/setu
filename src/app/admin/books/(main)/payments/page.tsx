import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { readPeriod } from "@/lib/books";
import { CHEQUE_STATUS_LABEL, issuedCheques, PAY_METHOD_LABEL, paymentsList } from "@/lib/supplier-payments";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import { ClearCheque } from "@/components/books/PaymentActions";
import type { SupplierPayMethod } from "@/generated/prisma/client";

type SP = Record<string, string | string[] | undefined>;
const METHODS: SupplierPayMethod[] = ["BANK", "CHEQUE", "CASH"];

/** Payments to suppliers in a period, and the register of cheques we wrote. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const period = readPeriod(sp);
  const method = METHODS.find((m) => m === sp.get("method")) ?? null;
  const supplier = sp.get("supplier");
  const r = await booksPage(async (ctx) => {
    const suppliers = await ctx.tx.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const list =
      "error" in period
        ? null
        : await paymentsList(ctx, period.from, period.to, {
            supplierId: supplier,
            method,
          });
    const cheques = await issuedCheques(ctx, "ISSUED");
    return { suppliers, list, cheques };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { suppliers, list, cheques } = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const q = new URLSearchParams({
    report: "payments",
    from,
    to,
    ...(supplier ? { supplier } : {}),
  });

  return (
    <div className="space-y-4">
      {r.me.canPay && (
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/books/payments/new" className="btn btn-mor btn-sm">
            <Icon name="plus" className="h-4 w-4" /> Pay a supplier
          </Link>
          <Link href="/admin/books/payables?report=due" className="btn btn-outline btn-sm">
            Bills due this week
          </Link>
        </div>
      )}

      <section className="card p-0 overflow-hidden">
        <div className="px-4 pt-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-heading font-bold text-[var(--ink)]">Our cheques not yet cleared</h2>
          <span className="text-sm tabular-nums text-[var(--muted)]">{formatINR(cheques.reduce((a, c) => a + c.amount, 0))}</span>
        </div>
        {cheques.length ? (
          <ul className="divide-y divide-[var(--line)] mt-2">
            {cheques.map((c) => (
              <li key={c.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold">Cheque {c.number}</span> · {c.payee}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {c.bank} · dated {showDay(c.date)}
                    {c.payment && (
                      <>
                        {" · "}
                        <Link href={`/admin/books/payments/${c.payment.id}`} className="text-[var(--accent-text)] font-semibold">
                          {c.payment.number}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums font-semibold">{formatINR(c.amount)}</span>
                  {r.me.canPay && <ClearCheque id={c.id} />}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 pb-4 pt-1 text-sm text-[var(--muted)]">None. Cheques we write show here until our bank pays them; a bank statement upload clears them too.</p>
        )}
      </section>

      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-56">
          Supplier
          <select name="supplier" defaultValue={supplier ?? ""} className="input !py-1.5 mt-1 block w-full">
            <option value="">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          Paid by
          <select name="method" defaultValue={method ?? ""} className="input !py-1.5 mt-1 block">
            <option value="">Any way</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {PAY_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          From
          <input type="date" name="from" defaultValue={from} className="input !py-1.5 mt-1 block" />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input type="date" name="to" defaultValue={to} className="input !py-1.5 mt-1 block" />
        </label>
        <button className="btn btn-mor btn-sm">Show</button>
      </form>

      {"error" in period && <ErrorCard message={period.error} />}
      {list && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">
              {showDay(list.from)} to {showDay(list.to)}
            </p>
            <div className="flex gap-2">
              <a className="btn btn-outline btn-xs" href={`/api/admin/books/payables?${q}&format=pdf`} target="_blank" rel="noreferrer">
                <Icon name="file" className="h-3.5 w-3.5" /> PDF
              </a>
              <a className="btn btn-outline btn-xs" href={`/api/admin/books/payables?${q}&format=csv`} download>
                <Icon name="download" className="h-3.5 w-3.5" /> CSV
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Paid to suppliers" value={formatINR(list.totals.paid)} sub={`${list.rows.filter((x) => !x.cancelled).length} payments`} />
            <Kpi label="By bank" value={formatINR(list.totals.bank)} />
            <Kpi label="By cheque" value={formatINR(list.totals.cheque)} sub={`cash ${formatINR(list.totals.cash)}`} />
            <Kpi label="TDS kept back" value={formatINR(list.totals.tds)} />
          </div>
          {list.rows.length ? (
            <section className="card p-0 overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 720 }}>
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                    <th className="px-4 py-2 text-left font-semibold">Date</th>
                    <th className="px-4 py-2 text-left font-semibold">Number</th>
                    <th className="px-4 py-2 text-left font-semibold">Supplier</th>
                    <th className="px-4 py-2 text-left font-semibold">Paid by</th>
                    <th className="px-4 py-2 text-right font-semibold">Amount</th>
                    <th className="px-4 py-2 text-right font-semibold">TDS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {list.rows.map((p) => (
                    <tr key={p.id} className={`hover:bg-black/[0.02] ${p.cancelled ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2 whitespace-nowrap">{showDay(p.date)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Link href={`/admin/books/payments/${p.id}`} className="font-semibold text-[var(--accent-text)]">
                          {p.number}
                        </Link>
                        {p.cancelled && <span className="chip !text-[10px] ml-1">{p.chequeStatus === "BOUNCED" ? "Bounced" : "Cancelled"}</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Link href={`/admin/books/suppliers/${p.supplierId}`} className="hover:text-[var(--accent-text)]">
                          {p.supplier}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        {PAY_METHOD_LABEL[p.method]} <span className="text-[var(--muted)]">{p.via}</span>
                        {p.chequeStatus === "ISSUED" && <span className="chip !text-[10px] ml-1">{CHEQUE_STATUS_LABEL.ISSUED}</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{p.cancelled ? "" : formatINR(p.amount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.cancelled || !p.tds ? "" : formatINR(p.tds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <Empty>No payments to suppliers in this period.</Empty>
          )}
          {list.capped && <p className="text-xs text-[var(--muted)]">Only the first 3,000 payments are shown. Pick a shorter period for the rest.</p>}
        </>
      )}
    </div>
  );
}
