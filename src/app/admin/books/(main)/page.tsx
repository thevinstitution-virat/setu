import { booksPage } from "@/lib/books-page";
import { booksLock, chartOfAccounts, ensureBooks, fyName, fyStart, GROUPS, HEAD_GROUPS, showDay, todayIst } from "@/lib/books";
import { ErrorCard, Kpi, rs } from "@/components/reports/Kit";
import ChartView from "@/components/books/ChartView";
import LockCard from "@/components/books/LockCard";
import { drcr } from "@/components/books/fmt";

/** Books home: where the money is, the chart of accounts with heads, and the books lock. */
export default async function BooksHome() {
  const r = await booksPage(async (ctx) => {
    await ensureBooks(ctx);
    const [chart, lock] = await Promise.all([chartOfAccounts(ctx), booksLock(ctx)]);
    return { chart, lock };
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  const { chart, lock } = r.data;
  const total = (...gs: string[]) => chart.groups.filter((g) => gs.includes(g.group)).reduce((s, g) => s + g.total, 0);
  const today = todayIst();

  return (
    <div className="space-y-4">
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
