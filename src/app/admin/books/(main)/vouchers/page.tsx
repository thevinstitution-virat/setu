import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { readPeriod } from "@/lib/books";
import { voucherList } from "@/lib/vouchers";
import { isVoucherType, VOUCHER_TYPE_HINT, VOUCHER_TYPE_LABEL, VOUCHER_TYPES } from "@/lib/voucher-labels";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";

type SP = Record<string, string | string[] | undefined>;
const SHORT = { PAYMENT: "Payment", RECEIPT: "Receipt", CONTRA: "Contra", JOURNAL: "Journal" } as const;

/** Payment, receipt, contra and journal vouchers in a period. */
export default async function VouchersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const period = readPeriod(sp);
  const t = sp.get("type");
  const type = isVoucherType(t) ? t : null;
  const q = sp.get("q") ?? "";
  const r = await booksPage(async (ctx) => ("error" in period ? null : voucherList(ctx, period.from, period.to, { type, q })));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const list = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const query = new URLSearchParams({ from, to, ...(type ? { type } : {}), ...(q ? { q } : {}) });
  const tab = (k: string | null) => `/admin/books/vouchers?${new URLSearchParams({ from, to, ...(k ? { type: k } : {}), ...(q ? { q } : {}) })}`;

  return (
    <div className="space-y-4">
      {r.me.canPost && (
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          {VOUCHER_TYPES.map((v) => (
            <Link key={v} href={`/admin/books/vouchers/new?type=${v}`} className="card p-3 hover:shadow-md transition-shadow">
              <span className="flex items-center gap-1.5 font-bold text-[var(--ink)]">
                <Icon name="plus" className="h-4 w-4" /> {SHORT[v]}
              </span>
              <span className="block text-xs text-[var(--muted)] mt-0.5 line-clamp-2">{VOUCHER_TYPE_HINT[v]}</span>
            </Link>
          ))}
        </div>
      )}

      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        {type && <input type="hidden" name="type" value={type} />}
        <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-56">
          Search
          <input name="q" defaultValue={q} placeholder="Number, head, paid to, narration" className="input !py-1.5 mt-1 block w-full" />
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

      <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Kind of voucher">
        {[null, ...VOUCHER_TYPES].map((k) => (
          <Link
            key={k ?? "all"}
            href={tab(k)}
            aria-current={k === type ? "page" : undefined}
            className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${k === type ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
          >
            {k ? SHORT[k] : "All"}
          </Link>
        ))}
      </nav>

      {"error" in period && <ErrorCard message={period.error} />}
      {list && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {VOUCHER_TYPES.map((k) => (
              <Kpi key={k} label={`${SHORT[k]}s`} value={formatINR(list.totals[k])} sub={`${list.counts[k]} vouchers`} href={tab(k)} />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[var(--muted)]">
              {showDay(list.from)} to {showDay(list.to)}
              {type ? ` · ${VOUCHER_TYPE_LABEL[type]}s` : ""}
            </p>
            <SharePdf
              url={`/api/admin/books/vouchers?${query}`}
              file={`vouchers-${from}-${to}`}
              summary={`Vouchers ${showDay(from)} to ${showDay(to)}: payments ${formatINR(list.totals.PAYMENT)}, receipts ${formatINR(list.totals.RECEIPT)}, contra ${formatINR(list.totals.CONTRA)}, journal ${formatINR(list.totals.JOURNAL)}.`}
            />
          </div>
          {list.rows.length ? (
            <section className="card p-0 overflow-hidden">
              <ul className="divide-y divide-[var(--line)]">
                {list.rows.map((v) => (
                  <li key={v.id} className={v.cancelled ? "opacity-50" : ""}>
                    <Link href={`/admin/books/vouchers/${v.id}`} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-black/[0.02]">
                      <span className="min-w-0">
                        <span className="text-sm">
                          <span className="font-semibold text-[var(--kesar-text)]">{v.number}</span>
                          <span className="chip !text-[10px] ml-1.5">{SHORT[v.type]}</span>
                          {v.cancelled && <span className="chip !text-[10px] ml-1">Cancelled</span>}
                        </span>
                        <span className="block text-sm text-[var(--ink)] truncate">{[v.what, v.party].filter(Boolean).join(" · ")}</span>
                        <span className="block text-xs text-[var(--muted)] truncate">
                          {showDay(v.date)}
                          {v.via ? ` · ${v.via}` : ""}
                          {v.narration && v.type !== "JOURNAL" ? ` · ${v.narration}` : ""}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block tabular-nums font-semibold">{formatINR(v.amount)}</span>
                        {(v.gst > 0 || v.tds > 0) && (
                          <span className="block text-[11px] text-[var(--muted)] tabular-nums">
                            {[v.gst ? `GST ${formatINR(v.gst)}` : "", v.tds ? `TDS ${formatINR(v.tds)}` : ""].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <Empty>No vouchers in this period{type ? " of this kind" : ""}.</Empty>
          )}
          {list.capped && <p className="text-xs text-[var(--muted)]">Only the first 3,000 vouchers are shown. Pick a shorter period for the rest.</p>}
        </>
      )}
    </div>
  );
}
