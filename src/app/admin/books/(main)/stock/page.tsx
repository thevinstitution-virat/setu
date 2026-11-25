import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { isDay, todayIst } from "@/lib/books";
import { closingStock, stockChoices, stockValuation } from "@/lib/stock-counts";
import { isValuationBy, VALUATION_BY } from "@/lib/stock-count-labels";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";

type SP = Record<string, string | string[] | undefined>;
const SHOW = 300;

/** Stock at cost as at the end of any day, and the closing stock the final accounts use. */
export default async function StockValuePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const today = todayIst();
  const day = isDay(sp.get("day")) && sp.get("day")! <= today ? sp.get("day")! : today;
  const b = sp.get("by");
  const by = isValuationBy(b) ? b : "company";
  const locationId = sp.get("locationId") || null;
  const supplierId = sp.get("supplierId") || null;
  const categoryId = sp.get("categoryId") || null;
  const r = await booksPage(async (ctx) => {
    const [choices, closing] = await Promise.all([stockChoices(ctx), closingStock(ctx, day)]);
    const v = choices.tracking ? await stockValuation(ctx, { day, by, locationId, supplierId, categoryId }) : null;
    return { choices, closing, v };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { choices, closing, v } = r.data;
  const query = new URLSearchParams({ day, by, ...(locationId ? { locationId } : {}), ...(supplierId ? { supplierId } : {}), ...(categoryId ? { categoryId } : {}) });
  const tab = (k: string) => `/admin/books/stock?${new URLSearchParams({ ...Object.fromEntries(query), by: k })}`;
  const filtered = !!(locationId || supplierId || categoryId);

  return (
    <div className="space-y-4">
      <section className="card p-4 sm:p-5 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-kick">Closing stock for the accounts</p>
            <p className="font-heading text-3xl font-bold tabular-nums text-[var(--ink)]">{formatINR(closing.value)}</p>
            <p className="text-sm text-[var(--ink-2)]">As at the end of {showDay(day)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/books/stock/counts" className="btn btn-outline btn-sm">
              <Icon name="clipboard" className="h-4 w-4" /> Stock counts
            </Link>
            {r.me.canPost && (
              <Link href="/admin/books/stock/counts/new" className="btn btn-mor btn-sm">
                <Icon name="plus" className="h-4 w-4" /> Start a count
              </Link>
            )}
          </div>
        </div>
        {closing.note && <p className="text-sm text-[var(--ink-2)]">{closing.note}</p>}
        {closing.warning && (
          <p className="text-sm rounded-lg bg-[#fff4e0] text-[#7a4b00] px-3 py-2">
            <Icon name="alert" className="h-4 w-4 inline -mt-0.5 mr-1" />
            {closing.warning}
          </p>
        )}
        {!choices.tracking && (
          <p className="text-sm text-[var(--muted)]">
            Stock tracking is off, so the app has no stock of its own to value. Enter a count of quantities and rates, or a value per company, as at the end of the year or month.
          </p>
        )}
      </section>

      {v && (
        <>
          <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="by" value={by} />
            <label className="text-xs text-[var(--muted)]">
              As at the end of
              <input type="date" name="day" defaultValue={day} max={today} className="input !py-1.5 mt-1 block" />
            </label>
            <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-40">
              Place
              <select name="locationId" defaultValue={locationId ?? ""} className="input !py-1.5 mt-1 block w-full">
                <option value="">Warehouses and vans</option>
                {choices.places
                  .filter((p) => p.kind !== "DAMAGED")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-40">
              Company
              <select name="supplierId" defaultValue={supplierId ?? ""} className="input !py-1.5 mt-1 block w-full">
                <option value="">All companies</option>
                {choices.companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.active ? "" : " (hidden)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-40">
              Category
              <select name="categoryId" defaultValue={categoryId ?? ""} className="input !py-1.5 mt-1 block w-full">
                <option value="">All categories</option>
                {choices.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-mor btn-sm">Show</button>
          </form>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={filtered ? "Stock at cost (filtered)" : "Stock at cost"} value={formatINR(v.total)} sub={`${v.units.toLocaleString("en-IN")} units`} />
            <Kpi label="In warehouses" value={formatINR(v.warehouse)} />
            <Kpi label="In vans" value={formatINR(v.van)} />
            <Kpi label="Damaged bin (not counted)" value={formatINR(v.damaged)} sub={v.damagedUnits ? `${v.damagedUnits.toLocaleString("en-IN")} units` : undefined} />
          </div>

          {(v.atLastCost > 0 || v.noCost > 0) && (
            <p className="text-sm text-[var(--ink-2)]">
              {v.atLastCost > 0 && `${v.atLastCost} products have batches with no cost of their own and are valued at their last cost. `}
              {v.noCost > 0 && `${v.noCost} products have no cost at all and count as ₹0; enter a purchase bill for them.`}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Group by">
              {VALUATION_BY.map((x) => (
                <Link
                  key={x.key}
                  href={tab(x.key)}
                  aria-current={x.key === by ? "page" : undefined}
                  className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${x.key === by ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
                >
                  By {x.label.toLowerCase()}
                </Link>
              ))}
            </nav>
            <SharePdf
              url={`/api/admin/books/stock?${query}`}
              file={`stock-value-${day}`}
              summary={`Stock at cost as at the end of ${showDay(day)}: ${formatINR(v.total)} (${v.units.toLocaleString("en-IN")} units).`}
            />
          </div>

          {v.rows.length ? (
            <section className="card p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--line)]">
                {(by === "product"
                  ? v.rows.map((p) => ({
                      key: p.productId,
                      name: p.name,
                      sub: `${p.company} · ${p.qty.toLocaleString("en-IN")} ${p.unit}${p.noCost ? " · no cost" : p.atLastCost ? " · last cost" : ""}`,
                      value: p.value,
                    }))
                  : v.groups.map((g) => ({ key: g.key, name: g.name, sub: `${g.products} products · ${g.qty.toLocaleString("en-IN")} units`, value: g.value }))
                )
                  .slice(0, SHOW)
                  .map((x) => (
                    <li key={x.key} className="flex items-start justify-between gap-3 px-4 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-[var(--ink)] truncate">{x.name}</span>
                        <span className="block text-xs text-[var(--muted)] truncate">{x.sub}</span>
                      </span>
                      <span className="shrink-0 tabular-nums font-semibold">{formatINR(x.value)}</span>
                    </li>
                  ))}
                <li className="flex items-center justify-between gap-3 px-4 py-2.5 bg-black/[0.02] font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">{formatINR(v.total)}</span>
                </li>
              </ul>
            </section>
          ) : (
            <Empty>
              No stock {filtered ? "for this choice " : ""}at the end of {showDay(day)}.
            </Empty>
          )}
          {by === "product" && v.rows.length > SHOW && <p className="text-xs text-[var(--muted)]">The first {SHOW} products by value are shown; the PDF and CSV have them all.</p>}
        </>
      )}
    </div>
  );
}
