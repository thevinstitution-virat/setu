import Link from "next/link";
import { loadReport, reportContext } from "@/lib/reports";
import { pageSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { DayColumns, ErrorCard, Kpi, Section, ShareBars, Table, dayLabel, num, pct, rs } from "@/components/reports/Kit";
import SummaryCard from "@/components/reports/SummaryCard";

const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CHEQUE: "Cheque", BANK: "Bank transfer", ONLINE: "Online (gateway)", WALLET: "From wallet", CREDIT_NOTE: "Credit notes" };

export default async function ReportsOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const d = await loadReport(ctx.tenantId, "dashboard", ctx.period);
  const session = await pageSession();
  const qs = ctx.sp.toString() ? `?${ctx.sp}` : "";

  return (
    <div className="space-y-5">
      <p className="text-xs text-[var(--muted)]">
        {dayLabel(d.period.from)} to {dayLabel(d.period.to)} ({d.period.days} day{d.period.days === 1 ? "" : "s"}), compared with {dayLabel(d.previous.from)} to {dayLabel(d.previous.to)}.
      </p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Net sales (invoiced)" value={rs(d.sales.net)} change={d.sales.change} href={`/admin/reports/sales${qs}`} />
        <Kpi label="Orders booked" value={rs(d.orders.value)} change={d.orders.change} sub={`${num(d.orders.count)} orders · avg ${rs(d.orders.avg)}`} />
        <Kpi label="Money received" value={rs(d.collections.received)} change={d.collections.change} sub={d.collections.pending.count ? `${d.collections.pending.count} to verify` : undefined} />
        <Kpi label="Outstanding today" value={rs(d.outstanding.total)} sub={`${rs(d.outstanding.overdue)} overdue${d.outstanding.dso !== null ? ` · ${d.outstanding.dso} days of sales` : ""}`} href="/admin/khata" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Stock value" value={rs(d.stock.total)} sub={d.stock.nearExpiry || d.stock.expired ? `${rs(d.stock.nearExpiry)} expiring soon · ${rs(d.stock.expired)} expired` : `${rs(d.stock.van)} in vans`} href="/admin/stock" />
        <Kpi label="Delivered" value={num(d.delivery.delivered)} sub={`${pct(d.delivery.successRate)} success · ${pct(d.delivery.onTimeRate)} on time`} />
        <Kpi label="Gross sales / credit notes" value={rs(d.sales.gross)} sub={`${rs(d.sales.credits)} credited back`} href={`/admin/reports/returns${qs}`} />
        <Kpi label="Cancelled orders" value={num(d.orders.cancelled)} sub={d.delivery.failed ? `${d.delivery.failed} ${d.delivery.failed === 1 ? "delivery" : "deliveries"} failed` : undefined} />
      </div>

      <Section title={d.byDay.length > 62 ? "Net sales per week" : "Net sales per day"} sub="Invoices less credit notes, with GST. Hover a column for the amount.">
        <DayColumns days={d.byDay} />
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Money received, by how it was paid" sub={`Against dues; wallet top-ups ${rs(d.collections.walletTopUps)} not counted.`}>
          <ShareBars rows={d.collections.byMethod.map((m) => ({ label: METHOD[m.method] ?? m.method, value: m.amount, note: `${m.count}` }))} />
        </Section>
        <Section title="Unpaid bills by age" sub={`${num(d.outstanding.shops)} shops owe ${rs(d.outstanding.total)}`} action={<Link href="/admin/khata" className="text-sm font-bold text-[var(--accent-text)]">Khata →</Link>}>
          <ShareBars rows={d.outstanding.ageing.map((a) => ({ label: a.label, value: a.amount, note: `${a.share}%` }))} />
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Shops owing the most">
          <Table
            head={["Shop", "Owes", "Overdue", "Oldest bill"]}
            align={["l", "r", "r", "r"]}
            rows={d.outstanding.debtors.map((r) => [
              <Link key={r.retailerId} href={`/admin/khata/${r.retailerId}`} className="hover:text-[var(--accent-text)]">
                {r.outletName}
                <span className="block text-xs font-normal text-[var(--muted)]">{r.area}</span>
              </Link>,
              rs(r.outstanding),
              r.overdue ? rs(r.overdue) : "–",
              `${r.oldestDays} days`,
            ])}
          />
        </Section>
        <Section title="Stock value by product" sub={`${rs(d.stock.warehouse)} in warehouses, ${rs(d.stock.van)} in vans, ${rs(d.stock.damaged)} in the damaged bin`}>
          <ShareBars rows={d.stock.top.map((p) => ({ label: p.name, value: p.value, note: `${p.qty}` }))} />
          {d.stock.uncostedLots > 0 && <p className="text-xs text-[var(--muted)]">{d.stock.uncostedLots} batches have no cost yet and count as ₹0.</p>}
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Sales by category" sub="Net taxable value" action={<Link href={`/admin/reports/sales${qs}`} className="text-sm font-bold text-[var(--accent-text)]">Sales →</Link>}>
          <ShareBars rows={d.categories.map((c) => ({ label: c.name, value: c.taxable, note: `${c.share}%` }))} />
        </Section>
        <Section title="Delivery" sub={`${num(d.delivery.trips)} trips · ${d.delivery.dropsPerTrip} drops a trip · ${pct(d.delivery.firstAttemptRate)} first attempt`}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Delivered" value={num(d.delivery.delivered)} />
            <Stat label="Not delivered" value={num(d.delivery.failed)} />
            <Stat label="Short lines" value={num(d.delivery.shortLines)} sub={rs(d.delivery.shortValue)} />
          </div>
          {d.delivery.failReasons.length > 0 && (
            <>
              <p className="text-xs font-semibold text-[var(--muted)] pt-1">Why not delivered</p>
              <ShareBars rows={d.delivery.failReasons.map((r) => ({ label: r.label, value: r.count }))} format={(v) => String(v)} />
            </>
          )}
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Section title="Sales team" sub={`Orders they booked in the period; target is for ${d.team.month}`} action={<Link href={`/admin/reports/team${qs}`} className="text-sm font-bold text-[var(--accent-text)]">Team →</Link>}>
          <Table
            head={["Name", "Orders", "Value", "Strike rate", "Collected", "Target"]}
            align={["l", "r", "r", "r", "r", "r"]}
            rows={d.team.sales.map((a) => [a.name, num(a.orders), rs(a.value), pct(a.strikeRate), rs(a.collected), a.target ? `${a.target.pct}%` : "–"])}
          />
        </Section>
        <SummaryCard canEdit={!!session && can(session.role, "settings.manage")} />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-black/[0.03] p-3">
      <p className="font-heading text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-[var(--muted)]">{label}</p>
      {sub && <p className="text-xs font-semibold text-[var(--ink)]">{sub}</p>}
    </div>
  );
}
