import Link from "next/link";
import { booksPage, readSearch } from "@/lib/books-page";
import { readPeriod, todayIst } from "@/lib/books";
import { cashBook, cashBookChoices } from "@/lib/vouchers";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import { drcr } from "@/lib/books-export";
import SharePdf from "@/components/reports/SharePdf";

type SP = Record<string, string | string[] | undefined>;

/** Cash book and bank book: any cash or bank account, day by day, with running balance; the bank book marks what the statement has shown. */
export default async function CashBookPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  if (!sp.get("from")) sp.set("from", `${todayIst().slice(0, 8)}01`);
  const period = readPeriod(sp, "today");
  const account = sp.get("account") || "OFFICE_CASH";
  const r = await booksPage(async (ctx) => ({ choices: await cashBookChoices(ctx), book: "error" in period ? null : await cashBook(ctx, account, period.from, period.to) }));
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { choices, book } = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const bank = book?.kind === "bank";
  const q = new URLSearchParams({ account, from, to });

  return (
    <div className="space-y-4">
      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)] min-w-0 w-full sm:w-auto sm:flex-1 sm:basis-56">
          Book
          <select name="account" defaultValue={account} className="input !py-1.5 mt-1 block w-full">
            <optgroup label="Cash book">
              {choices.cash.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Bank book">
              {choices.banks.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </optgroup>
            {choices.staff.length > 0 && (
              <optgroup label="Collected cash with staff">
                {choices.staff.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )}
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
      {book && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-heading text-xl font-bold text-[var(--ink)]">
              {bank ? "Bank book" : "Cash book"}: {book.name}
            </h2>
            <SharePdf
              url={`/api/admin/books/cashbook?${q}`}
              file={`${bank ? "bank" : "cash"}-book-${from}-${to}`}
              summary={`${bank ? "Bank book" : "Cash book"}, ${book.name}, ${showDay(from)} to ${showDay(to)}: opening ${drcr(book.opening)}, in ${formatINR(book.debit)}, out ${formatINR(book.credit)}, closing ${drcr(book.closing)}.`}
            />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label={`Opening ${showDay(from)}`} value={drcr(book.opening)} />
            <Kpi label="Money in" value={formatINR(book.debit)} />
            <Kpi label="Money out" value={formatINR(book.credit)} />
            <Kpi label={`Closing ${showDay(to)}`} value={drcr(book.closing)} />
          </div>

          {book.recon && (
            <section className="card p-4 space-y-2">
              <h3 className="font-heading font-bold text-[var(--ink)]">Against the bank statement</h3>
              {book.recon.statementBalance !== null ? (
                <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 max-w-2xl">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--muted)]">Statement balance on {showDay(book.recon.statementDate!)}</dt>
                    <dd className="tabular-nums font-semibold">{formatINR(book.recon.statementBalance)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[var(--muted)]">Statement lines not matched</dt>
                    <dd className="tabular-nums">
                      {book.recon.unmatchedLines} (in {formatINR(book.recon.unmatchedIn)}, out {formatINR(book.recon.unmatchedOut)})
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-[var(--muted)]">No statement with balances uploaded for this bank yet.</p>
              )}
              <p className="text-sm text-[var(--muted)]">
                In these books, not yet seen in a statement: in {formatINR(book.recon.notSeenIn)}, out {formatINR(book.recon.notSeenOut)}.{" "}
                <Link href="/admin/bank" className="underline">
                  Match the statement
                </Link>
              </p>
            </section>
          )}

          {book.days.length ? (
            <div className="space-y-3">
              {book.days.map((d) => (
                <section key={d.date} className="card p-0 overflow-hidden">
                  <div className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-2 bg-black/[0.02] border-b border-[var(--line)]">
                    <h3 className="font-heading font-bold text-[var(--ink)]">{showDay(d.date)}</h3>
                    <p className="text-xs text-[var(--muted)] tabular-nums">
                      in <span className="font-semibold text-[var(--ink)]">{formatINR(d.moneyIn)}</span> · out <span className="font-semibold text-[var(--ink)]">{formatINR(d.moneyOut)}</span> ·
                      closing <span className="font-semibold text-[var(--ink)]">{drcr(d.closing)}</span>
                    </p>
                  </div>
                  <ul className="divide-y divide-[var(--line)]">
                    {d.rows.map((row, i) => {
                      const body = (
                        <>
                          <span className="min-w-0">
                            <span className="block text-sm">
                              <span className="font-semibold">{row.kindLabel}</span>
                              {row.memo ? <span className="text-[var(--ink-2)]"> · {row.memo}</span> : null}
                            </span>
                            <span className="block text-xs text-[var(--muted)] truncate">
                              {row.against}
                              {bank && <span className={`chip !text-[10px] ml-1.5 ${row.inBank ? "chip-mint" : ""}`}>{row.inBank ? "In statement" : "Not seen yet"}</span>}
                            </span>
                          </span>
                          <span className="text-right shrink-0 tabular-nums">
                            {row.debit > 0 && <span className="block font-semibold text-[var(--mint-text)]">+{formatINR(row.debit)}</span>}
                            {row.credit > 0 && <span className="block font-semibold">−{formatINR(row.credit)}</span>}
                            <span className="block text-[11px] text-[var(--muted)]">{drcr(row.balance)}</span>
                          </span>
                        </>
                      );
                      return (
                        <li key={`${row.entryId}-${i}`}>
                          {row.href ? (
                            <Link href={row.href} className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-black/[0.02]">
                              {body}
                            </Link>
                          ) : (
                            <div className="flex items-start justify-between gap-3 px-4 py-2.5">{body}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <Empty>No money in or out of {book.name} in this period.</Empty>
          )}
          {book.capped && <p className="text-xs text-[var(--muted)]">Only the first 3,000 entries are shown. Pick a shorter period for the rest.</p>}
        </>
      )}
    </div>
  );
}
