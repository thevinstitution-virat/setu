import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage } from "@/lib/books-page";
import { countDetail, countProductChoices } from "@/lib/stock-counts";
import { ErrorCard } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import SharePdf from "@/components/reports/SharePdf";
import CountSheet from "@/components/books/CountSheet";
import { formatINR } from "@/lib/money";

/** One stock count: fill it on the phone, then accept it as the closing stock. */
export default async function CountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await booksPage(async (ctx) => {
    const count = await countDetail(ctx, id);
    const products = await countProductChoices(ctx, id);
    return { count, products };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { count: c, products } = r.data;
  const what = [c.place, c.company, c.category].filter(Boolean).join(" · ") || c.modeLabel;

  return (
    <div className="space-y-4">
      <Link href="/admin/books/stock/counts" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Stock counts
      </Link>
      <section className="card p-4 sm:p-5 space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="page-kick">
              {c.number} · {c.modeLabel}
            </p>
            <h2 className="font-heading text-xl font-bold text-[var(--ink)]">{what}</h2>
            <p className="text-sm text-[var(--ink-2)]">
              As at the end of {showDay(c.date)}
              {c.createdBy ? ` · started by ${c.createdBy}` : ""}
            </p>
          </div>
          <span className={`chip ${c.status === "ACCEPTED" ? "chip-mint" : ""}`}>{c.statusLabel}</span>
        </div>
        {c.note && <p className="text-sm text-[var(--muted)]">{c.note}</p>}
        {c.status === "ACCEPTED" && (
          <p className="text-sm text-[var(--ink-2)]">
            Accepted{c.acceptedBy ? ` by ${c.acceptedBy}` : ""}: closing stock {formatINR(c.totals.countedValue)} for {showDay(c.date)}.
            {c.entryId && (
              <>
                {" "}
                <Link href={`/admin/books/daybook?${new URLSearchParams({ from: c.date, to: c.date, kind: "STOCK_COUNT" })}`} className="font-semibold text-[var(--kesar-text)] underline">
                  See it in the day book
                </Link>
              </>
            )}
          </p>
        )}
        {c.status === "CANCELLED" && <p className="text-sm text-[#a8281e]">Cancelled: {c.cancelReason}</p>}
        <div className="pt-2">
          <SharePdf
            url={`/api/admin/books/stock/counts/${c.id}`}
            file={`stock-count-${c.number}`}
            summary={
              c.status === "ACCEPTED" ? `Stock count ${c.number} (${showDay(c.date)}): ${formatINR(c.totals.countedValue)} at cost.` : `Stock count sheet ${c.number} for ${what}, ${showDay(c.date)}.`
            }
          />
        </div>
      </section>
      <CountSheet key={`${c.status}:${c.totals.lines}:${c.totals.counted}`} count={c} products={products} canPost={r.me.canPost} />
    </div>
  );
}
