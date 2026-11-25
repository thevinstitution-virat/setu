import Link from "next/link";
import Icon from "@/components/Icon";
import { booksPage, readSearch } from "@/lib/books-page";
import { accountLedger, ensureBooks, ledgerChoices, readPeriod } from "@/lib/books";
import { Empty, ErrorCard, Kpi } from "@/components/reports/Kit";
import { amt, drcr, showDay } from "@/components/books/fmt";

type SP = Record<string, string | string[] | undefined>;

/** Any account's ledger for a period: opening, entries with the other side, running balance, closing. */
export default async function LedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = readSearch(await searchParams);
  const period = readPeriod(sp);
  const code = sp.get("account");
  const r = await booksPage(async (ctx) => {
    await ensureBooks(ctx);
    const choices = await ledgerChoices(ctx);
    const ledger = code && !("error" in period) ? await accountLedger(ctx, code, period.from, period.to) : null;
    return { choices, ledger };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { choices, ledger } = r.data;
  const from = "error" in period ? "" : period.from;
  const to = "error" in period ? "" : period.to;
  const groups = [...new Set(choices.map((c) => c.group))];
  const picked = code && !choices.some((c) => c.code === code) && ledger ? { code, label: ledger.name } : null;
  const q = code ? new URLSearchParams({ account: code, from, to }) : null;

  return (
    <div className="space-y-4">
      <form method="get" className="card p-4 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--muted)] min-w-0 flex-1 basis-64">
          Account
          <select name="account" defaultValue={code ?? ""} className="input !py-1.5 mt-1 block w-full" required>
            <option value="" disabled>
              Pick an account
            </option>
            {picked && <option value={picked.code}>{picked.label}</option>}
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {choices
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
              </optgroup>
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
        <p className="text-xs text-[var(--muted)] w-full">Starts at this financial year. A shop&apos;s own account opens from its khata.</p>
      </form>

      {"error" in period && <ErrorCard message={period.error} />}
      {!ledger && !("error" in period) && <Empty>Pick an account to see its ledger.</Empty>}
      {ledger && q && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-heading font-bold text-[var(--ink)]">{ledger.name}</h2>
              <p className="text-xs text-[var(--muted)]">
                {ledger.groupLabel} · {showDay(ledger.from)} to {showDay(ledger.to)}
              </p>
            </div>
            <div className="flex gap-2">
              <a className="btn btn-outline btn-xs" href={`/api/admin/books/ledger?${q}&format=pdf`} target="_blank" rel="noreferrer">
                <Icon name="file" className="h-3.5 w-3.5" /> PDF
              </a>
              <a className="btn btn-outline btn-xs" href={`/api/admin/books/ledger?${q}&format=csv`} download>
                <Icon name="download" className="h-3.5 w-3.5" /> CSV
              </a>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Opening balance" value={drcr(ledger.opening)} sub={`On ${showDay(ledger.from)}`} />
            <Kpi label="Debits" value={amt(ledger.debit) || "₹0.00"} sub="In this period" />
            <Kpi label="Credits" value={amt(ledger.credit) || "₹0.00"} sub="In this period" />
            <Kpi label="Closing balance" value={drcr(ledger.closing)} sub={`On ${showDay(ledger.to)}`} />
          </div>
          <section className="card p-0 overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 760 }}>
              <thead>
                <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
                  <th className="px-4 py-2 text-left font-semibold">Date</th>
                  <th className="px-4 py-2 text-left font-semibold">Particulars</th>
                  <th className="px-4 py-2 text-left font-semibold">Against</th>
                  <th className="px-4 py-2 text-right font-semibold">Debit</th>
                  <th className="px-4 py-2 text-right font-semibold">Credit</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                <tr className="bg-black/[0.02]">
                  <td className="px-4 py-2 whitespace-nowrap">{showDay(ledger.from)}</td>
                  <td className="px-4 py-2 font-semibold" colSpan={4}>
                    Opening balance
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{drcr(ledger.opening)}</td>
                </tr>
                {ledger.rows.map((x, i) => (
                  <tr key={`${x.entryId}-${i}`} className="hover:bg-black/[0.02]">
                    <td className="px-4 py-2 whitespace-nowrap">{showDay(x.date)}</td>
                    <td className="px-4 py-2">
                      <span className="font-medium text-[var(--ink)]">{x.kindLabel}</span>
                      {x.memo && <span className="text-[var(--muted)]">: {x.memo}</span>}
                    </td>
                    <td className="px-4 py-2 text-[var(--ink-2)]">
                      {x.href ? (
                        <Link href={x.href} className="hover:text-[var(--accent-text)]">
                          {x.against}
                        </Link>
                      ) : (
                        x.against
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{amt(x.debit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{amt(x.credit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{drcr(x.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-[var(--line)] font-semibold">
                  <td className="px-4 py-2" colSpan={3}>
                    Totals · closing balance on {showDay(ledger.to)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{amt(ledger.debit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{amt(ledger.credit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{drcr(ledger.closing)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          {!ledger.rows.length && <Empty>No entries in this period.</Empty>}
          {ledger.capped && <p className="text-xs text-[var(--muted)]">Only the first 3,000 entries are shown. Pick a shorter period for the rest.</p>}
        </>
      )}
    </div>
  );
}
