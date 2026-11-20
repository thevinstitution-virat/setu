import { loadReport, reportContext } from "@/lib/reports";
import { ErrorCard, Kpi, rs } from "@/components/reports/Kit";
import ShopsTable from "@/components/reports/ShopsTable";

export default async function ShopsReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const r = await loadReport(ctx.tenantId, "retailers", ctx.period);
  const qs = ctx.sp.toString() ? `?${ctx.sp}` : "";

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Shops that ordered" value={`${r.ordering} of ${r.shops}`} />
        <Kpi label="Average order" value={rs(r.avgOrder)} />
        <Kpi label="At risk or slipping" value={String(r.risk.high + r.risk.medium)} sub={`${r.risk.high} at risk · ${r.risk.medium} slipping`} />
        <Kpi label="Their sales before" value={rs(r.atRiskValue)} sub="What those shops bought in the period before" />
      </div>
      <ShopsTable rows={r.rows} counts={r.risk} query={qs} />
    </div>
  );
}
