import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { readPeriod } from "@/lib/books";
import { DOC_LABEL, purchaseRegister } from "@/lib/purchases";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { amt, showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import type { PurchaseDocType } from "@/generated/prisma/client";

type SP = Record<string, string | string[] | undefined>;
const TYPES: PurchaseDocType[] = ["BILL", "DEBIT_NOTE", "CREDIT_NOTE"];
const SHORT: Record<PurchaseDocType, string> = { BILL: "Bill", DEBIT_NOTE: "Debit note", CREDIT_NOTE: "Credit note" };

/** The purchase register: bills and notes of a period, with GST and an export for the CA. */
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const period = readPeriod(sp);
  const type = TYPES.find((t) => t === sp.get("type")) ?? null;
  const supplier = sp.get("supplier");
  const r = await booksPage(async (ctx) => {
    const suppliers = await ctx.tx.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    const register = "error" in period ? null : await purchaseRegister(ctx, period.from, period.to, { supplierId: supplier, type });
    return { suppliers, register };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { suppliers, register } = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const q = new URLSearchParams({ from, to, ...(type ? { type } : {}), ...(supplier ? { supplier } : {}) });
  const sign = (t: PurchaseDocType, p: number) => (t === "BILL" ? p : -p);

  return (
    <div className="space-y-4">
      {r.me.canPurchase && (
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/books/purchases/new" className="btn btn-mor btn-sm">
            <Icon name="plus" className="h-4 w-4" /> Purchase bill
          </Link>
          <Link href="/admin/books/purchases/new?type=DEBIT_NOTE" className="btn btn-outline btn-sm">
            Debit note to supplier
          </Link>
          <Link href="/admin/books/purchases/new?type=CREDIT_NOTE" className="btn btn-outline btn-sm">
            Credit note from supplier
          </Link>
        </div>
      )}

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
          Type
          <select name="type" defaultValue={type ?? ""} className="input !py-1.5 mt-1 block">
            <option value="">Bills and notes</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_LABEL[t]}
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
      {register && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">
              {showDay(register.from)} to {showDay(register.to)} · notes are shown minus
            </p>
            <div className="flex gap-2">
              <a className="btn btn-outline btn-xs" href={`/api/admin/books/purchases?${q}&format=pdf`} target="_blank" rel="noreferrer">
                <Icon name="file" className="h-3.5 w-3.5" /> PDF
              </a>
              <a className="btn btn-outline btn-xs" href={`/api/admin/books/purchases?${q}&format=csv`} download>
                <Icon name="download" className="h-3.5 w-3.5" /> CSV
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Purchases (net)" value={formatINR(register.totals.total)} sub={`${register.docs.filter((d) => !d.cancelled).length} documents`} />
            <Kpi label="Taxable value" value={formatINR(register.totals.taxable)} />
            <Kpi label="GST on purchases" value={formatINR(register.totals.cgst + register.totals.sgst + register.totals.igst)} sub={`IGST ${formatINR(register.totals.igst)}`} />
            <Kpi label="Input tax we can claim" value={formatINR(register.totals.itcTax)} />
          </div>
          {register.docs.length ? (
            <section className="card p-0 overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 820 }}>
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                    <th className="px-4 py-2 text-left font-semibold">Date</th>
                    <th className="px-4 py-2 text-left font-semibold">Our number</th>
                    <th className="px-4 py-2 text-left font-semibold">Their bill</th>
                    <th className="px-4 py-2 text-left font-semibold">Supplier</th>
                    <th className="px-4 py-2 text-right font-semibold">Taxable</th>
                    <th className="px-4 py-2 text-right font-semibold">GST</th>
                    <th className="px-4 py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {register.docs.map((d) => (
                    <tr key={d.id} className={`hover:bg-black/[0.02] ${d.cancelled ? "opacity-50" : ""}`}>
                      <td className="px-4 py-2 whitespace-nowrap">{showDay(d.date)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <Link href={`/admin/books/purchases/${d.id}`} className="font-semibold text-[var(--kesar-text)]">
                          {d.number}
                        </Link>
                        {d.cancelled && <span className="chip !text-[10px] ml-1">Cancelled</span>}
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-[var(--muted)]">{SHORT[d.type]}</span> {d.supplierRef}
                        {d.reverseCharge && <span className="chip !text-[10px] ml-1">RCM</span>}
                      </td>
                      <td className="px-4 py-2">
                        <Link href={`/admin/books/suppliers/${d.supplierId}`} className="hover:text-[var(--kesar-text)]">
                          {d.supplier}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{d.cancelled ? "" : amt(sign(d.type, d.taxable))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{d.cancelled ? "" : amt(sign(d.type, d.cgst + d.sgst + d.igst))}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{d.cancelled ? "" : amt(sign(d.type, d.total))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <Empty>No purchase bills or notes in this period.</Empty>
          )}
          {register.rates.length > 0 && (
            <section className="card p-4">
              <h2 className="font-heading font-bold text-[var(--ink)] mb-2">By GST rate</h2>
              <dl className="grid gap-1 text-sm tabular-nums max-w-md">
                {register.rates.map((x) => (
                  <div key={x.rate} className="flex justify-between gap-4">
                    <dt className="text-[var(--muted)]">GST {x.rate}%</dt>
                    <dd>
                      {formatINR(x.taxable)} <span className="text-[var(--muted)]">+ tax {formatINR(x.tax)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {register.capped && <p className="text-xs text-[var(--muted)]">Only the first 3,000 documents are shown. Pick a shorter period for the rest.</p>}
        </>
      )}
    </div>
  );
}
