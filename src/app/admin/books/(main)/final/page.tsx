import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { fyStart, isDay, todayIst } from "@/lib/books";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/final-accounts";
import { plRows } from "@/lib/final-accounts-export";
import { ErrorCard, Kpi } from "@/components/reports/Kit";
import { drcr, showDay } from "@/components/books/fmt";
import { formatINR } from "@/lib/money";
import SharePdf from "@/components/reports/SharePdf";

type SP = Record<string, string | string[] | undefined>;
const REPORTS = [
  { key: "pl", label: "Profit and loss" },
  { key: "bs", label: "Balance sheet" },
  { key: "tb", label: "Trial balance" },
] as const;
type Report = (typeof REPORTS)[number]["key"];
const signed = (p: number) => (p < 0 ? `(${formatINR(-p)})` : formatINR(p));
const monthName = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

/** Final accounts: profit and loss, balance sheet and trial balance, for any period. */
export default async function FinalAccountsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const today = todayIst();
  const rq = sp.get("report");
  const report: Report = rq === "bs" || rq === "tb" ? rq : "pl";
  const to = isDay(sp.get("to")) ? sp.get("to")! : today;
  const from = isDay(sp.get("from")) && sp.get("from")! <= to ? sp.get("from")! : fyStart(to);
  const r = await booksPage(async (ctx) => {
    if (report === "pl") return { kind: "pl" as const, p: await profitAndLoss(ctx, from, to, { months: true, compare: true }) };
    if (report === "bs") return { kind: "bs" as const, b: await balanceSheet(ctx, to) };
    return { kind: "tb" as const, t: await trialBalance(ctx, from, to) };
  });
  const q = (k: Report) => `/admin/books/final?${new URLSearchParams({ report: k, from, to })}`;
  const apiQ = `/api/admin/books/final?${new URLSearchParams({ report, from, to })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Report">
          {REPORTS.map((x) => (
            <Link
              key={x.key}
              href={q(x.key)}
              aria-current={x.key === report ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${x.key === report ? "bg-ink text-white" : "bg-black/5 text-foreground/70"}`}
            >
              {x.label}
            </Link>
          ))}
        </nav>
        <div className="flex gap-2">
          <Link href="/admin/books/year-end" className="btn btn-outline btn-sm">
            <Icon name="lock" className="h-4 w-4" /> Year end and CA pack
          </Link>
        </div>
      </div>

      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="report" value={report} />
        {report !== "bs" && (
          <label className="text-xs text-[var(--muted)]">
            From
            <input type="date" name="from" defaultValue={from} max={today} className="input !py-1.5 mt-1 block" />
          </label>
        )}
        <label className="text-xs text-[var(--muted)]">
          {report === "bs" ? "As at the end of" : "To"}
          <input type="date" name="to" defaultValue={to} max={today} className="input !py-1.5 mt-1 block" />
        </label>
        <button className="btn btn-mor btn-sm">Show</button>
      </form>

      {!r.ok ? (
        <ErrorCard message={r.error} />
      ) : r.data.kind === "pl" ? (
        <ProfitAndLoss p={r.data.p} apiQ={apiQ} />
      ) : r.data.kind === "bs" ? (
        <BalanceSheet b={r.data.b} apiQ={apiQ} />
      ) : (
        <Trial t={r.data.t} apiQ={apiQ} />
      )}
    </div>
  );
}

type PL = Awaited<ReturnType<typeof profitAndLoss>>;
type BS = Awaited<ReturnType<typeof balanceSheet>>;
type TB = Awaited<ReturnType<typeof trialBalance>>;

function Notes({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      {items.map((w) => (
        <p key={w} className="text-sm rounded-lg bg-[#fff4e0] text-[#7a4b00] px-3 py-2">
          <Icon name="alert" className="h-4 w-4 inline -mt-0.5 mr-1" />
          {w}
        </p>
      ))}
    </div>
  );
}

function ProfitAndLoss({ p, apiQ }: { p: PL; apiQ: string }) {
  const ly = p.lastYear;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Net sales" value={formatINR(p.sales.net)} sub={ly ? `Last year ${formatINR(ly.salesNet)}` : undefined} />
        <Kpi label={p.grossProfit >= 0 ? "Gross profit" : "Gross loss"} value={signed(p.grossProfit)} sub={p.sales.net ? `${((p.grossProfit / p.sales.net) * 100).toFixed(1)}% of sales` : undefined} />
        <Kpi label="Expenses less other income" value={signed(p.indirect.total - p.otherIncome.total)} />
        <Kpi label={p.netProfit >= 0 ? "Net profit" : "Net loss"} value={signed(p.netProfit)} sub={ly ? `Last year ${signed(ly.netProfit)}` : undefined} />
      </div>
      <Notes items={p.warnings} />
      <div className="flex justify-end">
        <SharePdf
          url={apiQ}
          file={`profit-and-loss-${p.from}-to-${p.to}`}
          summary={`Profit and loss ${showDay(p.from)} to ${showDay(p.to)}: net sales ${formatINR(p.sales.net)}, gross profit ${signed(p.grossProfit)}, net profit ${signed(p.netProfit)}.`}
        />
      </div>
      <section className="card p-0 overflow-hidden">
        <ul className="divide-y divide-[var(--line)]">
          {plRows(p).map((row, i) =>
            row.kind === "group" ? (
              <li key={i} className="px-4 py-2 bg-black/[0.03] text-xs font-bold uppercase tracking-wide text-[var(--ink-2)]">
                {row.label}
              </li>
            ) : (
              <li key={i} className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${row.kind === "row" ? "" : row.kind === "sub" ? "font-semibold" : "font-bold bg-black/[0.02]"}`}>
                <span className={`min-w-0 ${row.kind === "row" ? "pl-2 text-[var(--ink-2)]" : "text-[var(--ink)]"}`}>{row.label}</span>
                <span className="tabular-nums shrink-0">{row.amount === null ? "" : signed(row.amount)}</span>
              </li>
            ),
          )}
        </ul>
      </section>
      {p.months && p.months.length > 1 && (
        <section className="card p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <h3 className="font-heading font-bold text-[var(--ink)]">Month by month</h3>
            <a className="btn btn-outline btn-xs" href={`${apiQ}&format=pdf&months=1`} target="_blank" rel="noreferrer">
              PDF
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-xs text-[var(--muted)]">
                <tr className="border-t border-[var(--line)]">
                  <th className="text-left font-medium px-4 py-2">Month</th>
                  <th className="text-right font-medium px-3 py-2">Sales</th>
                  <th className="text-right font-medium px-3 py-2">Gross profit</th>
                  <th className="text-right font-medium px-3 py-2">Expenses</th>
                  <th className="text-right font-medium px-4 py-2">Net profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {p.months.map((m) => (
                  <tr key={m.month}>
                    <td className="px-4 py-2 whitespace-nowrap">{monthName(m.month)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatINR(m.sales, { whole: true })}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{signed(m.grossProfit)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{signed(m.running)}</td>
                    <td className={`px-4 py-2 text-right whitespace-nowrap font-semibold ${m.netProfit < 0 ? "text-[#a8281e]" : ""}`}>{signed(m.netProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="text-xs text-[var(--muted)]">
        Purchases are cost when bought, so stock is added back: opening stock {formatINR(p.openingStock)} (
        {p.openingStockFrom === "opening" ? "from the opening balances" : p.openingStockFrom === "count" ? "counted" : "the app's stock at cost"}), closing stock {formatINR(p.closingStock)} (
        {p.closingStockFrom === "count" ? "counted" : p.closingStockFrom === "book" ? "the app's stock at cost" : "no count"}).
      </p>
    </>
  );
}

function BalanceSheet({ b, apiQ }: { b: BS; apiQ: string }) {
  const side = (title: string, secs: BS["assets"], total: number) => (
    <section className="card p-0 overflow-hidden">
      <h3 className="px-4 py-3 font-heading font-bold text-[var(--ink)]">{title}</h3>
      <ul className="divide-y divide-[var(--line)] border-t border-[var(--line)]">
        {secs.map((s) => (
          <li key={s.key}>
            <div className="flex items-center justify-between gap-3 px-4 py-2 bg-black/[0.03] text-sm font-semibold">
              <span>{s.label}</span>
              <span className="tabular-nums">{signed(s.total)}</span>
            </div>
            <ul>
              {s.lines.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-3 px-4 py-1.5 text-sm">
                  {l.href ? (
                    <Link href={l.href} className="min-w-0 pl-2 text-[var(--ink-2)] hover:underline">
                      {l.name}
                      {l.count ? ` (${l.count})` : ""}
                    </Link>
                  ) : (
                    <span className="min-w-0 pl-2 text-[var(--ink-2)]">{l.name}</span>
                  )}
                  <span className="tabular-nums shrink-0">{signed(l.amount)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
        <li className="flex items-center justify-between gap-3 px-4 py-2.5 font-bold">
          <span>Total</span>
          <span className="tabular-nums">{formatINR(total)}</span>
        </li>
      </ul>
    </section>
  );
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi label="Total assets" value={formatINR(b.totalAssets)} />
        <Kpi label="Profit this year" value={signed(b.profit.thisYear)} sub={`From ${showDay(b.profit.from)}`} />
        <Kpi label="Balances" value={b.difference ? `Out by ${formatINR(Math.abs(b.difference))}` : "Yes"} sub={b.difference ? "See the checks below" : "Assets = capital and liabilities"} />
      </div>
      <Notes items={[...(b.stock.warning ? [`Stock: ${b.stock.warning}`] : []), ...b.failing.map((f) => `${f.title}: ${f.detail}`)]} />
      <div className="flex justify-end">
        <SharePdf url={apiQ} file={`balance-sheet-${b.asOn}`} summary={`Balance sheet as at ${showDay(b.asOn)}: total ${formatINR(b.totalAssets)}; profit this year ${signed(b.profit.thisYear)}.`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {side("Capital and liabilities", b.liabilities, b.totalLiabilities)}
        {side("Assets", b.assets, b.totalAssets)}
      </div>
    </>
  );
}

function Trial({ t, apiQ }: { t: TB; apiQ: string }) {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Debits in the period" value={formatINR(t.totals.debit)} />
        <Kpi label="Credits in the period" value={formatINR(t.totals.credit)} />
        <Kpi label="Closing debit balances" value={formatINR(t.totals.closingDr)} />
        <Kpi
          label="Agrees"
          value={t.difference ? `Out by ${drcr(t.difference)}` : "Yes"}
          sub={t.difference ? "Run Check my books" : "Debits = credits"}
          href={t.difference ? "/admin/books/check" : undefined}
        />
      </div>
      <div className="flex justify-end">
        <SharePdf
          url={apiQ}
          file={`trial-balance-${t.from}-to-${t.to}`}
          summary={`Trial balance ${showDay(t.from)} to ${showDay(t.to)}: closing ${formatINR(t.totals.closingDr)} Dr = ${formatINR(t.totals.closingCr)} Cr.`}
        />
      </div>
      <section className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-[var(--muted)]">
              <tr>
                <th className="text-left font-medium px-4 py-2">Account</th>
                <th className="text-right font-medium px-3 py-2">Opening</th>
                <th className="text-right font-medium px-3 py-2">Debit</th>
                <th className="text-right font-medium px-3 py-2">Credit</th>
                <th className="text-right font-medium px-4 py-2">Closing</th>
              </tr>
            </thead>
            {t.groups.map((g) => (
              <tbody key={g.group} className="border-t border-[var(--line)]">
                <tr className="bg-black/[0.03] font-semibold">
                  <td className="px-4 py-2">{g.label}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{g.opening ? drcr(g.opening) : ""}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{g.debit ? formatINR(g.debit) : ""}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">{g.credit ? formatINR(g.credit) : ""}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{g.closing ? drcr(g.closing) : ""}</td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-4 py-1.5 min-w-[11rem]">
                      {r.href ? (
                        <Link href={r.href} className="pl-2 text-[var(--ink-2)] hover:underline">
                          {r.name}
                          {r.count ? ` (${r.count})` : ""}
                        </Link>
                      ) : (
                        <span className="pl-2">{r.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{r.opening ? drcr(r.opening) : ""}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{r.debit ? formatINR(r.debit) : ""}</td>
                    <td className="px-3 py-1.5 text-right whitespace-nowrap">{r.credit ? formatINR(r.credit) : ""}</td>
                    <td className="px-4 py-1.5 text-right whitespace-nowrap">{r.closing ? drcr(r.closing) : ""}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot className="border-t border-[var(--line)] font-bold">
              <tr>
                <td className="px-4 py-2">Total</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatINR(t.totals.openingDr)} Dr</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatINR(t.totals.debit)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatINR(t.totals.credit)}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">{formatINR(t.totals.closingDr)} Dr</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
