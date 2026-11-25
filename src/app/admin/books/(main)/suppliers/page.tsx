import Link from "next/link";
import { booksPage, readSearch } from "@/lib/books-page";
import { supplierSummary, SUPPLIER_KINDS } from "@/lib/purchases";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { formatINR } from "@/lib/money";
import SupplierEditor, { blankSupplier } from "@/components/books/SupplierEditor";

type SP = Record<string, string | string[] | undefined>;

/** Suppliers as creditors: what we owe each one, open bills and what is past due. */
export default async function SuppliersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const all = sp.get("all") === "1";
  const r = await booksPage((ctx) => supplierSummary(ctx, { includeInactive: all }));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const rows = r.data;
  const owed = rows.reduce((a, x) => a + Math.max(0, x.owed), 0);
  const overdue = rows.reduce((a, x) => a + x.overdue, 0);
  const advances = rows.reduce((a, x) => a + Math.max(0, -x.owed), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {r.me.canPurchase && <SupplierEditor initial={blankSupplier} buttonLabel="Add a supplier" buttonClass="btn btn-mor btn-sm" />}
        </div>
        <Link href={all ? "/admin/books/suppliers" : "/admin/books/suppliers?all=1"} className="text-sm font-semibold text-[var(--kesar-text)]">
          {all ? "Hide suppliers not in use" : "Show suppliers not in use too"}
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="We owe suppliers" value={formatINR(owed)} sub={`${rows.filter((x) => x.owed > 0).length} suppliers`} />
        <Kpi label="Past due" value={formatINR(overdue)} sub="Bills after their due date" />
        <Kpi label="Paid ahead (advances)" value={formatINR(advances)} sub="They owe us goods or money" />
        <Kpi label="Open bills" value={String(rows.reduce((a, x) => a + x.openBills, 0))} />
      </div>
      {rows.length ? (
        <section className="card p-0 overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 680 }}>
            <thead>
              <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                <th className="px-4 py-2 text-left font-semibold">Supplier</th>
                <th className="px-4 py-2 text-left font-semibold">Kind</th>
                <th className="px-4 py-2 text-right font-semibold">Open bills</th>
                <th className="px-4 py-2 text-right font-semibold">Past due</th>
                <th className="px-4 py-2 text-right font-semibold">We owe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {rows.map((x) => (
                <tr key={x.id} className={`hover:bg-black/[0.02] ${x.active ? "" : "opacity-60"}`}>
                  <td className="px-4 py-2">
                    <Link href={`/admin/books/suppliers/${x.id}`} className="font-semibold text-[var(--ink)] hover:text-[var(--kesar-text)]">
                      {x.name}
                    </Link>
                    <span className="block text-xs text-[var(--muted)]">{[x.gstin, `${x.creditDays} days' credit`].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="px-4 py-2 text-[var(--ink-2)]">{SUPPLIER_KINDS[x.kind].split(" (")[0]}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{x.openBills || ""}</td>
                  <td className={`px-4 py-2 text-right tabular-nums ${x.overdue ? "text-[#a8281e] font-semibold" : ""}`}>{x.overdue ? formatINR(x.overdue) : ""}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{x.owed ? (x.owed > 0 ? formatINR(x.owed) : `${formatINR(-x.owed)} ahead`) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : (
        <Empty>No suppliers yet.</Empty>
      )}
      <p className="text-xs text-[var(--muted)]">Companies added under Stock show here too. Paying suppliers comes in the next step of the books.</p>
    </div>
  );
}
