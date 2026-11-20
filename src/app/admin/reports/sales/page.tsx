import { loadReport, reportContext } from "@/lib/reports";
import { DayColumns, ErrorCard, Kpi, Section, ShareBars, Table, num, pct, rs } from "@/components/reports/Kit";

export default async function SalesReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const { days, mix } = await loadReport(ctx.tenantId, "sales", ctx.period);
  const net = days.reduce((a, d) => a + d.net, 0);
  const best = days.reduce((a, d) => (d.net > a.net ? d : a), days[0]);
  const selling = days.filter((d) => d.net > 0).length;
  const brands = new Map<string, number>();
  for (const p of mix.products) brands.set(p.brand ?? "No brand", (brands.get(p.brand ?? "No brand") ?? 0) + p.taxable);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Net sales with GST" value={rs(net)} />
        <Kpi label="Net taxable value" value={rs(mix.total)} sub="Without GST, after credit notes" />
        <Kpi label="Days with sales" value={`${selling} of ${days.length}`} sub={selling ? `avg ${rs(Math.round(net / selling))} a day` : undefined} />
        <Kpi label="Best day" value={best && best.net > 0 ? rs(best.net) : "–"} sub={best && best.net > 0 ? best.day : undefined} />
      </div>
      <Section title={days.length > 62 ? "Net sales per week" : "Net sales per day"} sub="Hover a column for the amount. The CSV has every day.">
        <DayColumns days={days} />
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="By category" sub="Share of net taxable value">
          <ShareBars rows={mix.categories.map((c) => ({ label: c.name, value: c.taxable, note: `${c.share}%` }))} />
        </Section>
        <Section title="By brand">
          <ShareBars rows={[...brands.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, value]) => ({ label, value, note: `${mix.total ? Math.round((value * 1000) / mix.total) / 10 : 0}%` }))} />
        </Section>
      </div>
      <Section title="Products" sub="Sold less returned, net of credit notes">
        <Table
          head={["Product", "Category", "Quantity", "Net taxable", "Share"]}
          align={["l", "l", "r", "r", "r"]}
          rows={mix.products.map((p) => [
            <span key={p.productId}>
              {p.name}
              <span className="block text-xs font-normal text-[var(--muted)]">{p.sku}</span>
            </span>,
            p.category,
            num(p.qty),
            rs(p.taxable),
            pct(p.share),
          ])}
        />
      </Section>
    </div>
  );
}
