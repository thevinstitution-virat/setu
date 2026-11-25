import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { fyStart, isDay, todayIst } from "@/lib/books";
import { addDay, yearEnd } from "@/lib/final-accounts";
import { ErrorCard } from "@/components/reports/Kit";
import { showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import CloseYear from "@/components/books/CloseYear";

type SP = Record<string, string | string[] | undefined>;

/** Year end: what is needed to close a financial year, closing it, and the CA pack. */
export default async function YearEndPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const today = todayIst();
  const lastYearDay = addDay(fyStart(today), -1);
  const picked = sp.get("fy");
  const r = await booksPage(async (ctx) => {
    let day = picked && /^\d{4}$/.test(picked) ? `${picked}-04-01` : null;
    if (!day) {
      // The year just ended until it is closed, then this year.
      const last = await yearEnd(ctx, lastYearDay);
      day = last.closed ? today : lastYearDay;
    }
    if (day > today) day = today;
    return yearEnd(ctx, day);
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const y = r.data;
  const from = sp.get("from") && isDay(sp.get("from")) ? sp.get("from")! : y.from;
  const to = sp.get("to") && isDay(sp.get("to")) ? sp.get("to")! : y.over ? y.to : today;
  const ready = y.steps.every((s) => s.ok);
  const startYear = Number(y.from.slice(0, 4));
  const years = [startYear - 1, startYear, startYear + 1].filter((n) => `${n}-04-01` <= today);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Financial year">
          {years.map((n) => (
            <Link
              key={n}
              href={`/admin/books/year-end?fy=${n}`}
              aria-current={n === startYear ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${n === startYear ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
            >
              FY {n}-{String((n + 1) % 100).padStart(2, "0")}
            </Link>
          ))}
        </nav>
        <Link href="/admin/books/opening" className="btn btn-outline btn-sm">
          Opening balances
        </Link>
      </div>

      <section className="card p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="page-kick">
              {showDay(y.from)} to {showDay(y.to)}
            </p>
            <h2 className="font-heading text-xl font-bold text-[var(--ink)]">Close FY {y.fy}</h2>
            <p className="text-sm text-[var(--ink-2)]">
              {y.over ? "Profit for the year" : "Profit so far"}: <span className="font-semibold tabular-nums">{formatINR(y.profit)}</span>{" "}
              <Link href={`/admin/books/final?${new URLSearchParams({ report: "pl", from: y.from, to: y.over ? y.to : today })}`} className="text-[var(--kesar-text)] underline">
                P&amp;L
              </Link>
              {" · "}
              <Link href={`/admin/books/final?${new URLSearchParams({ report: "bs", to: y.over ? y.to : today })}`} className="text-[var(--kesar-text)] underline">
                balance sheet
              </Link>
            </p>
          </div>
          {y.closed && <span className="chip chip-mint">Closed</span>}
        </div>
        <ol className="space-y-2">
          {y.steps.map((s) => (
            <li key={s.key} className="flex items-start gap-2 text-sm">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${s.ok ? "bg-[#2e7d4f] text-white" : "bg-black/10 text-[var(--muted)]"}`}>
                <Icon name={s.ok ? "check" : "alert"} className="h-3 w-3" />
              </span>
              <span className={s.ok ? "text-[var(--ink-2)]" : "text-[var(--ink)]"}>
                {s.text}
                {s.key === "check" && !s.ok && (
                  <>
                    {" "}
                    <Link href="/admin/books/check" className="text-[var(--kesar-text)] underline">
                      Check my books
                    </Link>
                  </>
                )}
                {s.key === "count" && !s.ok && y.over && (
                  <>
                    {" "}
                    <Link href="/admin/books/stock/counts/new" className="text-[var(--kesar-text)] underline">
                      Start a count
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
        {y.closed ? (
          <p className="text-sm text-[var(--ink-2)]">
            The books are closed up to {showDay(y.lockedUntil!)}. FY {y.nextYear} has its own numbers from 1 April, its profit and loss starts at zero and the balance sheet carries on; the count at{" "}
            {showDay(y.to)} is its opening stock.
          </p>
        ) : y.over && r.me.canLock ? (
          <CloseYear to={y.to} fy={y.fy} ready={ready} />
        ) : !y.over ? (
          <p className="text-sm text-[var(--muted)]">Close the year after {showDay(y.to)}, once its count is in and its bills are entered.</p>
        ) : (
          <p className="text-sm text-[var(--muted)]">The owner or the accountant closes the year.</p>
        )}
        {y.lockedUntil && !y.closed && <p className="text-xs text-[var(--muted)]">The books are closed up to {showDay(y.lockedUntil)}.</p>}
      </section>

      <section className="card p-4 sm:p-5 space-y-3">
        <div>
          <h2 className="font-heading text-lg font-bold text-[var(--ink)]">CA pack</h2>
          <p className="text-sm text-[var(--ink-2)]">
            One zip for the CA: trial balance, profit and loss (with months) and balance sheet as PDFs; a workbook with the day book, every ledger, cash and bank books, purchase register, debtors,
            creditors, claims, stock, the GSTR-3B working by month, the input credit register and the TDS registers and challans; and the sales register.
          </p>
        </div>
        <form method="get" action="/api/admin/books/ca-pack" className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-[var(--muted)]">
            From
            <input type="date" name="from" defaultValue={from} max={today} className="input !py-1.5 mt-1 block" />
          </label>
          <label className="text-xs text-[var(--muted)]">
            To
            <input type="date" name="to" defaultValue={to} max={today} className="input !py-1.5 mt-1 block" />
          </label>
          <button className="btn btn-mor btn-sm">
            <Icon name="download" className="h-4 w-4" /> Download the CA pack
          </button>
        </form>
        <p className="text-xs text-[var(--muted)]">A year&apos;s pack can take a minute to make. At most 400 days at a time.</p>
      </section>
    </div>
  );
}
