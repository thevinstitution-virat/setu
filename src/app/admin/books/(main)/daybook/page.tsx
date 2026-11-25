import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { dayBook, KIND_LABEL, readPeriod } from "@/lib/books";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { amt, showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import type { EntryKind } from "@/generated/prisma/client";

type SP = Record<string, string | string[] | undefined>;

/** Every entry of a day (default today) or period, by voucher type; debits always equal credits. */
export default async function DayBookPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const period = readPeriod(sp, "today");
  const k = sp.get("kind");
  const kind = k && k in KIND_LABEL ? (k as EntryKind) : null;
  const r = await booksPage(async (ctx) => ("error" in period ? null : dayBook(ctx, period.from, period.to, kind)));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const book = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const q = new URLSearchParams({ from, to, ...(kind ? { kind } : {}) });

  return (
    <div className="space-y-4">
      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)]">
          From
          <input type="date" name="from" defaultValue={from} className="input !py-1.5 mt-1 block" />
        </label>
        <label className="text-xs text-[var(--muted)]">
          To
          <input type="date" name="to" defaultValue={to} className="input !py-1.5 mt-1 block" />
        </label>
        <label className="text-xs text-[var(--muted)]">
          Type
          <select name="kind" defaultValue={kind ?? ""} className="input !py-1.5 mt-1 block">
            <option value="">All types</option>
            {Object.entries(KIND_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-mor btn-sm">Show</button>
        <div className="ml-auto flex gap-2">
          <a className="btn btn-outline btn-xs" href={`/api/admin/books/daybook?${q}&format=pdf`} target="_blank" rel="noreferrer">
            <Icon name="file" className="h-3.5 w-3.5" /> PDF
          </a>
          <a className="btn btn-outline btn-xs" href={`/api/admin/books/daybook?${q}&format=csv`} download>
            <Icon name="download" className="h-3.5 w-3.5" /> CSV
          </a>
        </div>
      </form>

      {"error" in period && <ErrorCard message={period.error} />}
      {book && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Entries" value={book.entries.length.toLocaleString("en-IN")} sub={from === to ? `On ${showDay(from)}` : `${showDay(from)} to ${showDay(to)}`} />
            <Kpi label="Debits" value={formatINR(book.debit)} />
            <Kpi label="Credits" value={formatINR(book.credit)} />
            <Kpi label="Check" value={book.debit === book.credit ? "Agrees" : "Off"} sub={book.debit === book.credit ? "Debits = credits" : "Run Check my books"} />
          </div>
          {book.kinds.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {book.kinds.map((x) => (
                <Link key={x.kind} href={`/admin/books/daybook?${new URLSearchParams({ from, to, kind: x.kind })}`} className="rounded-full border border-[var(--line)] bg-white/60 px-3 py-1 text-xs text-foreground/70 hover:bg-white">
                  {x.label} · {x.count} · {formatINR(x.amount, { whole: true })}
                </Link>
              ))}
            </div>
          )}
          {!book.entries.length ? (
            <Empty>No entries in this period.</Empty>
          ) : (
            <ul className="space-y-2">
              {book.entries.map((e) => (
                <li key={e.id} className="card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm">
                      <span className="font-heading font-bold text-[var(--ink)]">{e.kindLabel}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {" "}
                        · {showDay(e.date)} {e.time}
                      </span>
                      {e.reversed && <span className="ml-1.5 chip !text-[10px]">Reversed</span>}
                    </p>
                    <span className="text-sm font-bold tabular-nums">{formatINR(e.total)}</span>
                  </div>
                  {e.memo && (
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {e.href ? (
                        <Link href={e.href} className="hover:text-[var(--accent-text)]">
                          {e.memo}
                        </Link>
                      ) : (
                        e.memo
                      )}
                    </p>
                  )}
                  <table className="w-full text-xs mt-2">
                    <tbody>
                      {e.lines.map((l, i) => (
                        <tr key={i}>
                          <td className={`py-0.5 ${l.credit ? "pl-6" : ""} text-[var(--ink-2)]`}>{l.credit ? `To ${l.account}` : l.account}</td>
                          <td className="py-0.5 w-28 text-right tabular-nums">{amt(l.debit)}</td>
                          <td className="py-0.5 w-28 text-right tabular-nums">{amt(l.credit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </li>
              ))}
            </ul>
          )}
          {book.capped && <p className="text-xs text-[var(--muted)]">Only the first 1,000 entries are shown. Pick a shorter period for the rest.</p>}
        </>
      )}
    </div>
  );
}
