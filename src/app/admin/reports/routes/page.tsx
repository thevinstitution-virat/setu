import { loadReport, reportContext } from "@/lib/reports";
import { pageSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { ErrorCard, Kpi, Section, Table, dayLabel, num, pct, rs } from "@/components/reports/Kit";
import CostForm from "@/components/reports/CostForm";

export default async function RoutesReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const [r, session] = await Promise.all([loadReport(ctx.tenantId, "routes", ctx.period), pageSession()]);
  const t = r.totals;
  const neg = (v: number) => (v < 0 ? <span className="text-[var(--risk-text)]">{rs(v)}</span> : rs(v));

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Net sales (without GST)" value={rs(t.revenue)} sub={`${num(t.drops)} drops`} />
        <Kpi label="Gross margin" value={rs(t.margin)} sub={`${pct(t.marginPct)} of sales`} />
        <Kpi label="Delivery cost" value={rs(t.deliveryCost)} sub={r.costs.tripCost || r.costs.dropCost ? undefined : "Not set yet"} />
        <Kpi label="Left after delivery" value={rs(t.contribution)} sub={t.revenue ? `${Math.round((t.contribution * 1000) / t.revenue) / 10}% of sales` : undefined} />
      </div>
      <Section title="Delivery cost" sub="Used to work out what each area and trip leaves you.">
        <CostForm tripCost={r.costs.tripCost} dropCost={r.costs.dropCost} canEdit={!!session && can(session.role, "settings.manage")} />
      </Section>
      <Section title="By area" sub="Cost of goods is what the stock cost you (or the product's last purchase cost). Best first.">
        <Table
          head={["Area", "Shops", "Drops", "Net sales", "Gross margin", "Margin %", "Delivery cost", "Left", "Sales a drop"]}
          align={["l", "r", "r", "r", "r", "r", "r", "r", "r"]}
          rows={r.areas.map((a) => [a.name, num(a.shops), num(a.drops), rs(a.revenue), neg(a.margin), pct(a.marginPct), rs(a.deliveryCost), neg(a.contribution), rs(a.perDrop)])}
        />
        {t.uncosted > 0 && <p className="text-xs text-[var(--muted)]">{rs(t.uncosted)} of sales are of products with no purchase cost yet; their margin counts as 100%. Receive them once in Stock to fix this.</p>}
      </Section>
      <Section title="By trip" sub="Latest first (up to 60).">
        <Table
          head={["Trip", "Day", "Driver", "Drops", "Net sales", "Gross margin", "Delivery cost", "Left"]}
          align={["l", "l", "l", "r", "r", "r", "r", "r"]}
          rows={r.trips.map((x) => [
            <span key={x.tripId}>
              {x.number}
              {x.vehicle && <span className="block text-xs font-normal text-[var(--muted)]">{x.vehicle}</span>}
            </span>,
            `${dayLabel(x.date)} · ${x.slot}`,
            x.driver,
            num(x.drops),
            rs(x.revenue),
            neg(x.margin),
            rs(x.deliveryCost),
            neg(x.contribution),
          ])}
        />
      </Section>
    </div>
  );
}
