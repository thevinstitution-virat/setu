import Link from "next/link";
import { booksPage, readSearch } from "@/lib/books-page";
import { isDay, readPeriod, todayIst } from "@/lib/books";
import { AGE_LABEL, billsFallingDue, openBillsOn, payablesBySupplier, PAY_METHOD_LABEL, paymentsList } from "@/lib/supplier-payments";
import { payablesSummary } from "@/lib/payables-export";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";

type SP = Record<string, string | string[] | undefined>;
const REPORTS = [
  { key: "suppliers", label: "Supplier-wise" },
  { key: "bills", label: "Bill-wise" },
  { key: "due", label: "Due this week" },
  { key: "payments", label: "Payments made" },
] as const;
type Report = (typeof REPORTS)[number]["key"];

type Bill = Awaited<ReturnType<typeof openBillsOn>>[number];

/** What we owe suppliers (as on a day), what falls due this week, and what we paid. */
export default async function PayablesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const report: Report = REPORTS.find((x) => x.key === sp.get("report"))?.key ?? "suppliers";
  const asOn = isDay(sp.get("asOn")) ? sp.get("asOn")! : todayIst();
  const supplier = sp.get("supplier") || null;
  const period = readPeriod(sp);
  const r = await booksPage(async (ctx) => {
    const suppliers = await ctx.tx.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    const f = { supplierId: supplier };
    if (report === "bills") return { suppliers, bills: await openBillsOn(ctx, asOn, f) };
    if (report === "due") return { suppliers, due: await billsFallingDue(ctx, asOn, 7, f) };
    if (report === "payments")
      return {
        suppliers,
        payments: "error" in period ? null : await paymentsList(ctx, period.from, period.to, f),
      };
    return { suppliers, bySupplier: await payablesBySupplier(ctx, asOn, f) };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const d = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const q = new URLSearchParams({
    report,
    ...(report === "payments" ? { from, to } : { asOn }),
    ...(supplier ? { supplier } : {}),
  });
  const file = report === "payments" ? `supplier-payments-${from}-to-${to}` : `payables-${report}-${asOn}`;
  const summary = payablesSummary(report, {
    asOn,
    bySupplier: d.bySupplier,
    bills: d.bills,
    due: d.due,
    payments: d.payments ?? undefined,
  });

  return (
    <div className="space-y-4">
      <div className="card p-3 space-y-3">
        <nav className="flex gap-1.5 overflow-x-auto" aria-label="Payables report">
          {REPORTS.map((x) => {
            const href = new URLSearchParams({
              ...(x.key !== "suppliers" ? { report: x.key } : {}),
              ...(sp.get("asOn") ? { asOn } : {}),
              ...(supplier ? { supplier } : {}),
            });
            const on = x.key === report;
            return (
              <Link
                key={x.key}
                href={`/admin/books/payables${href.toString() ? `?${href}` : ""}`}
                aria-current={on ? "page" : undefined}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold border ${on ? "border-[var(--kesar)] bg-[var(--kesar-tint)] text-[var(--kesar-text)]" : "border-[var(--line)] bg-white/60 text-foreground/70 hover:bg-white"}`}
              >
                {x.label}
              </Link>
            );
          })}
        </nav>
        <form method="get" className="flex flex-wrap items-end gap-2">
          {report !== "suppliers" && <input type="hidden" name="report" value={report} />}
          <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-56">
            Supplier
            <select name="supplier" defaultValue={supplier ?? ""} className="input !py-1.5 !text-sm mt-1 block w-full">
              <option value="">All suppliers</option>
              {d.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {report === "payments" ? (
            <>
              <label className="text-xs text-[var(--muted)]">
                From
                <input type="date" name="from" defaultValue={from} className="input !py-1.5 !text-sm mt-1 block" />
              </label>
              <label className="text-xs text-[var(--muted)]">
                To
                <input type="date" name="to" defaultValue={to} className="input !py-1.5 !text-sm mt-1 block" />
              </label>
            </>
          ) : (
            <label className="text-xs text-[var(--muted)]">
              {report === "due" ? "From" : "As on"}
              <input type="date" name="asOn" defaultValue={asOn} max={todayIst()} className="input !py-1.5 !text-sm mt-1 block" />
            </label>
          )}
          <button className="btn btn-mor btn-sm">Show</button>
        </form>
        <SharePdf url={`/api/admin/books/payables?${q}`} file={file} summary={summary} />
      </div>

      {d.bySupplier && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="We owe suppliers" value={formatINR(d.bySupplier.totals.owed)} sub={`as on ${showDay(asOn)}`} />
            <Kpi label="Not yet due" value={formatINR(d.bySupplier.totals.notDue)} />
            <Kpi label="1–30 days late" value={formatINR(d.bySupplier.totals.d30)} />
            <Kpi label="Over 30 days late" value={formatINR(d.bySupplier.totals.d60 + d.bySupplier.totals.d90 + d.bySupplier.totals.older)} />
          </div>
          {d.bySupplier.rows.length ? (
            <section className="card p-0 overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 760 }}>
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                    <th className="px-4 py-2 text-left font-semibold">Supplier</th>
                    <th className="px-3 py-2 text-right font-semibold">{AGE_LABEL.notDue}</th>
                    <th className="px-3 py-2 text-right font-semibold">1–30 late</th>
                    <th className="px-3 py-2 text-right font-semibold">31–60</th>
                    <th className="px-3 py-2 text-right font-semibold">61–90</th>
                    <th className="px-3 py-2 text-right font-semibold">Over 90</th>
                    <th className="px-4 py-2 text-right font-semibold">Owed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {d.bySupplier.rows.map((s) => (
                    <tr key={s.id} className="hover:bg-black/[0.02]">
                      <td className="px-4 py-2">
                        <Link href={`/admin/books/suppliers/${s.id}`} className="font-semibold hover:text-[var(--kesar-text)]">
                          {s.name}
                        </Link>
                        <span className="block text-xs text-[var(--muted)]">{s.bills ? `${s.bills} open bill${s.bills === 1 ? "" : "s"}` : "No open bills"}</span>
                      </td>
                      {(["notDue", "d30", "d60", "d90", "older"] as const).map((k) => (
                        <td key={k} className={`px-3 py-2 text-right tabular-nums ${k !== "notDue" && s[k] ? "text-[#a8281e]" : ""}`}>
                          {s[k] ? formatINR(s[k]) : ""}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{s.owed < 0 ? <span className="text-[var(--muted)]">{formatINR(-s.owed)} ahead</span> : formatINR(s.owed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <Empty>We owe no supplier anything on this day.</Empty>
          )}
        </>
      )}

      {d.bills && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Open bills" value={String(d.bills.length)} sub={`as on ${showDay(asOn)}`} />
            <Kpi label="Still to pay" value={formatINR(d.bills.reduce((a, b) => a + b.left, 0))} />
            <Kpi label="Late" value={formatINR(d.bills.filter((b) => b.late > 0).reduce((a, b) => a + b.left, 0))} />
            <Kpi label="Over 60 days late" value={formatINR(d.bills.filter((b) => b.late > 60).reduce((a, b) => a + b.left, 0))} />
          </div>
          {d.bills.length ? <BillTable bills={d.bills} /> : <Empty>No supplier bills were open on this day.</Empty>}
        </>
      )}

      {d.due && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Late already" value={formatINR(d.due.totals.overdue)} sub={`${d.due.overdue.length} bills`} />
            <Kpi label={`Due by ${showDay(d.due.until)}`} value={formatINR(d.due.totals.soon)} sub={`${d.due.soon.length} bills`} />
          </div>
          {d.due.overdue.length > 0 && (
            <>
              <h2 className="font-heading font-bold text-[var(--ink)]">Late already</h2>
              <BillTable bills={d.due.overdue} pay={r.me.canPay} />
            </>
          )}
          {d.due.soon.length > 0 && (
            <>
              <h2 className="font-heading font-bold text-[var(--ink)]">Due this week</h2>
              <BillTable bills={d.due.soon} pay={r.me.canPay} />
            </>
          )}
          {!d.due.overdue.length && !d.due.soon.length && <Empty>Nothing to pay this week.</Empty>}
        </>
      )}

      {report === "payments" && "error" in period && <ErrorCard message={period.error} />}
      {d.payments && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Paid" value={formatINR(d.payments.totals.paid)} sub={`${showDay(d.payments.from)} to ${showDay(d.payments.to)}`} />
            <Kpi label="By bank" value={formatINR(d.payments.totals.bank)} />
            <Kpi label="By cheque · cash" value={formatINR(d.payments.totals.cheque)} sub={`cash ${formatINR(d.payments.totals.cash)}`} />
            <Kpi label="TDS kept back" value={formatINR(d.payments.totals.tds)} />
          </div>
          {d.payments.rows.length ? (
            <section className="card p-0 overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 680 }}>
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
                  {d.payments.rows.map((p) => (
                    <tr key={p.id} className={p.cancelled ? "opacity-50" : ""}>
                      <td className="px-4 py-2 whitespace-nowrap">{showDay(p.date)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Link href={`/admin/books/payments/${p.id}`} className="font-semibold text-[var(--kesar-text)]">
                          {p.number}
                        </Link>
                        {p.cancelled && <span className="chip !text-[10px] ml-1">Cancelled</span>}
                      </td>
                      <td className="px-4 py-2">{p.supplier}</td>
                      <td className="px-4 py-2">
                        {PAY_METHOD_LABEL[p.method]} <span className="text-[var(--muted)]">{p.via}</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{p.cancelled ? "" : formatINR(p.amount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{p.cancelled || !p.tds ? "" : `${formatINR(p.tds)} ${p.tdsSection ?? ""}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <Empty>No payments to suppliers in this period.</Empty>
          )}
        </>
      )}
    </div>
  );
}

function BillTable({ bills, pay = false }: { bills: Bill[]; pay?: boolean }) {
  return (
    <section className="card p-0 overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: 700 }}>
        <thead>
          <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
            <th className="px-4 py-2 text-left font-semibold">Supplier</th>
            <th className="px-4 py-2 text-left font-semibold">Their bill</th>
            <th className="px-4 py-2 text-left font-semibold">Date</th>
            <th className="px-4 py-2 text-left font-semibold">Due</th>
            <th className="px-4 py-2 text-right font-semibold">To pay</th>
            <th className="px-4 py-2 text-right font-semibold">Days late</th>
            {pay && <th className="px-4 py-2" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {bills.map((b) => (
            <tr key={b.id} className="hover:bg-black/[0.02]">
              <td className="px-4 py-2">
                <Link href={`/admin/books/suppliers/${b.supplierId}`} className="hover:text-[var(--kesar-text)]">
                  {b.supplier}
                </Link>
              </td>
              <td className="px-4 py-2">
                {b.purchaseBillId ? (
                  <Link href={`/admin/books/purchases/${b.purchaseBillId}`} className="font-semibold text-[var(--kesar-text)]">
                    {b.number}
                  </Link>
                ) : (
                  <span className="font-semibold">{b.number}</span>
                )}
                {b.kind === "OPENING" && <span className="chip !text-[10px] ml-1">Old books</span>}
              </td>
              <td className="px-4 py-2 whitespace-nowrap">{showDay(b.date)}</td>
              <td className={`px-4 py-2 whitespace-nowrap ${b.late ? "text-[#a8281e] font-semibold" : ""}`}>{showDay(b.dueDate)}</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatINR(b.left)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{b.late || ""}</td>
              {pay && (
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/books/payments/new?supplier=${b.supplierId}`} className="btn btn-outline btn-xs">
                    Pay
                  </Link>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
