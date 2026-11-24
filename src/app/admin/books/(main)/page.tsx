import { booksPage } from "@/lib/books-page";
import { booksLock, chartOfAccounts, ensureBooks, fyName, fyStart, GROUPS, HEAD_GROUPS, showDay, todayIst } from "@/lib/books";
import { ErrorCard, Kpi, rs } from "@/components/reports/Kit";
import ChartView from "@/components/books/ChartView";
import LockCard from "@/components/books/LockCard";
import { drcr } from "@/components/books/fmt";
import { ownerFigures } from "@/lib/final-accounts";

/** Books home: where the money is, the chart of accounts with heads, and the books lock. */
export default async function BooksHome() {
  const r = await booksPage(async (ctx) => {
    await ensureBooks(ctx);
    const [chart, lock] = await Promise.all([chartOfAccounts(ctx), booksLock(ctx)]);
    const figures = await ownerFigures(ctx);
    return { chart, lock, figures };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { chart, lock, figures: f } = r.data;
  const monthLabel = new Date(`${f.month.from}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" });
  const plHref = `/admin/books/final?${new URLSearchParams({ report: "pl", from: f.month.from, to: f.month.to })}`;
  const total = (...gs: string[]) => chart.groups.filter((g) => gs.includes(g.group)).reduce((s, g) => s + g.total, 0);
  const today = todayIst();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={`Sales in ${monthLabel}`} value={rs(f.month.sales)} sub="After returns, so far this month" href={plHref} />
        <Kpi label="Gross profit" value={rs(f.month.grossProfit)} sub={f.month.sales ? `${((f.month.grossProfit / f.month.sales) * 100).toFixed(1)}% of sales` : "Sales less cost of goods"} href={plHref} />
        <Kpi label="Expenses" value={rs(f.month.running)} sub="Running costs less other income" href={plHref} />
        <Kpi label="Net profit" value={rs(f.month.netProfit)} sub={f.month.warnings.length ? "Stock not counted: an estimate" : "This month so far"} href={plHref} />
        <Kpi label="We owe suppliers" value={rs(f.payables.owed)} sub={f.payables.late ? `${rs(f.payables.late)} past due` : "Nothing past due"} href="/admin/books/payables" />
        <Kpi label="Claims on companies" value={rs(f.claims.open)} sub={f.claims.count ? `${f.claims.count} open${f.claims.older ? ` · ${rs(f.claims.older)} over 60 days` : ""}` : "None open"} href="/admin/books/claims" />
        <Kpi label="GST to pay" value={rs(Math.max(0, f.gst))} sub={f.gst < 0 ? `Input credit left ${rs(-f.gst)}` : "Output tax less input credit"} />
        <Kpi label="TDS to pay" value={rs(f.tds)} sub="Kept back from suppliers" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Cash and bank" value={rs(total("CASH", "BANK"))} sub="Office, staff, petty cash and banks" href="/admin/books/banks" />
        <Kpi label="Shops owe" value={rs(total("DEBTORS"))} sub="Open bills less unused payments" href="/admin/reports/outstanding" />
        <Kpi label="Money on the way" value={rs(total("IN_TRANSIT"))} sub="UPI, cheques and gateway, not yet in the bank" />
        <Kpi label="Trial balance" value={chart.difference ? drcr(chart.difference) : "Agrees"} sub={chart.difference ? "Run Check my books" : `Debits = credits · FY ${fyName(today)}`} href="/admin/books/check" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px] items-start">
        <ChartView
          groups={chart.groups.map((g) => ({ ...g, rows: g.rows.map((x) => ({ key: x.key, name: x.name, balance: x.balance, href: x.href, count: x.count, headId: x.headId, active: x.active, note: x.note, group: x.group })) }))}
          headGroups={HEAD_GROUPS.map((g) => ({ group: g, label: GROUPS[g].label }))}
          canSetup={r.me.canSetup}
        />
        <div className="space-y-4">
          <LockCard lockedUntil={lock} today={today} canLock={r.me.canLock} isOwner={r.me.isOwner} />
          <section className="card p-4 space-y-2 text-xs text-[var(--muted)]">
            <h2 className="font-heading font-bold text-sm text-[var(--ink)]">How the books work</h2>
            <p>Every sale, receipt, cheque, handover and adjustment is already an entry here: nothing is entered twice.</p>
            <p>The financial year runs 1 April to 31 March. Reports default to this year (from {showDay(fyStart(today))}).</p>
            <p>Heads are your own accounts: expenses, income, assets, loans and capital. Hide one you no longer use; its entries stay.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
