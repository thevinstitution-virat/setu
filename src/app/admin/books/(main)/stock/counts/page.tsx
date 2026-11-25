import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { countList } from "@/lib/stock-counts";
import { Empty, ErrorCard } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";

/** Physical stock counts, newest first. */
export default async function CountsPage() {
  const r = await booksPage((ctx) => countList(ctx));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const counts = r.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/admin/books/stock" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
          <Icon name="arrow" className="h-4 w-4 rotate-180" /> Stock value
        </Link>
        {r.me.canPost && (
          <Link href="/admin/books/stock/counts/new" className="btn btn-mor btn-sm">
            <Icon name="plus" className="h-4 w-4" /> Start a count
          </Link>
        )}
      </div>
      <h2 className="font-heading text-xl font-bold text-[var(--ink)]">Stock counts</h2>
      {counts.length ? (
        <section className="card p-0 overflow-hidden">
          <ul className="divide-y divide-[var(--line)]">
            {counts.map((c) => (
              <li key={c.id} className={c.status === "CANCELLED" ? "opacity-50" : ""}>
                <Link href={`/admin/books/stock/counts/${c.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-black/[0.02]">
                  <span className="min-w-0">
                    <span className="text-sm">
                      <span className="font-semibold text-[var(--kesar-text)]">{c.number}</span>
                      <span className={`chip !text-[10px] ml-1.5 ${c.status === "ACCEPTED" ? "chip-mint" : ""}`}>{c.statusLabel}</span>
                    </span>
                    <span className="block text-sm text-[var(--ink)] truncate">{c.what}</span>
                    <span className="block text-xs text-[var(--muted)]">
                      {showDay(c.date)} · {c.counted} of {c.lines} counted
                    </span>
                  </span>
                  {c.status === "ACCEPTED" && (
                    <span className="text-right shrink-0 tabular-nums">
                      <span className="block font-semibold">{formatINR(c.countedValue)}</span>
                      {c.mode === "TRACKED" && (c.shortage > 0 || c.excess > 0) && (
                        <span className="block text-[11px] text-[var(--muted)]">
                          {[c.shortage ? `short ${formatINR(c.shortage)}` : "", c.excess ? `over ${formatINR(c.excess)}` : ""].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Empty>No stock counts yet. Count at the end of each month or year; the accepted count is the closing stock for that day.</Empty>
      )}
    </div>
  );
}
