import Link from "next/link";
import { loadReport, reportContext } from "@/lib/reports";
import { ErrorCard, Kpi, Section, Table, num, pct, rs } from "@/components/reports/Kit";

export default async function SchemesReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const s = await loadReport(ctx.tenantId, "schemes", ctx.period);
  const roi = s.totals.extra !== null && s.totals.cost ? Math.round((s.totals.extra / s.totals.cost) * 10) / 10 : null;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Given away in schemes" value={rs(s.totals.cost)} sub="Discounts and free goods" />
        <Kpi label="Sales on scheme orders" value={rs(s.totals.sales)} sub={s.totals.cost ? `${Math.round((s.totals.sales / s.totals.cost) * 10) / 10}× the cost` : undefined} />
        <Kpi label="Extra sales" value={s.totals.extra === null ? "–" : rs(s.totals.extra)} sub="Beyond normal growth" />
        <Kpi label="Return on schemes" value={roi === null ? "–" : `${roi}×`} sub="Extra sales ÷ cost" />
      </div>
      <Section
        title="Each scheme"
        sub={
          !s.fullHistory
            ? "Your records start inside the period before, so a fair before-and-after is not possible yet. Pick a shorter period."
            : s.controlGrowth === null
            ? "Every shop that bought used a scheme, so there is no fair comparison for extra sales. Pick a longer period, or keep some shops off schemes."
            : `Extra sales = how much more the shops on the scheme bought than in the period before, after the ${s.controlGrowth}% change the ${s.controlShops} shops with no scheme had anyway.`
        }
        action={<Link href="/admin/schemes" className="text-sm font-bold text-[var(--accent-text)]">Schemes →</Link>}
      >
        <Table
          head={["Scheme", "Cost", "Orders", "Shops", "Sales on orders", "Shops before → now", "Uplift", "Extra sales", "ROI", "Budget used"]}
          align={["l", "r", "r", "r", "r", "r", "r", "r", "r", "r"]}
          rows={s.schemes.map((r) => [
            <span key={r.schemeId}>
              {r.name}
              {!r.active && <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">(off)</span>}
            </span>,
            rs(r.cost),
            num(r.orders),
            num(r.shops),
            rs(r.sales),
            `${rs(r.before)} → ${rs(r.after)}`,
            pct(r.uplift),
            r.extra === null ? "–" : rs(r.extra),
            r.roi === null ? "–" : `${r.roi}×`,
            pct(r.budgetUsed),
          ])}
        />
        {!s.schemes.length && <p className="text-sm text-[var(--muted)]">No scheme was used in this period.</p>}
      </Section>
    </div>
  );
}
