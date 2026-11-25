import Link from "next/link";
import { loadReport, reportContext } from "@/lib/reports";
import { ErrorCard, Kpi, Section, ShareBars, Table, num, pct, rs } from "@/components/reports/Kit";

export default async function ReturnsReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const r = await loadReport(ctx.tenantId, "returns", ctx.period);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Goods returned" value={pct(r.returnRate)} sub={`of ${rs(r.sales)} sales`} />
        <Kpi label="All credit notes" value={rs(r.credits)} sub={`${pct(r.creditRate)} of sales`} />
        <Kpi label="Short at delivery" value={rs(r.short.value)} sub={`${num(r.short.lines)} lines`} />
        <Kpi label="Damaged in stock" value={rs(r.damage.value)} sub={`${num(r.damage.qty)} units · ${rs(r.damage.writtenOff)} written off`} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Credit notes by kind">
          <ShareBars rows={r.noteKinds.map((k) => ({ label: k.label, value: k.value, note: `${k.count}` }))} />
        </Section>
        <Section title="Why short at delivery">
          <ShareBars rows={r.short.reasons.map((k) => ({ label: k.label, value: k.value, note: `${k.qty} units` }))} />
        </Section>
        <Section title="Why goods went to damaged">
          <ShareBars rows={r.damage.reasons.map((k) => ({ label: k.key === "expired" ? "Expired" : k.key === "damaged" ? "Damaged" : k.key, value: k.value, note: `${k.qty} units` }))} />
        </Section>
      </div>
      <Section title="Products with the most returns, shorts and damage" sub="Rate = returned and short ÷ (sold + short)">
        <Table
          head={["Product", "Sold", "Returned", "Short", "Damaged", "Value", "Rate"]}
          align={["l", "r", "r", "r", "r", "r", "r"]}
          rows={r.products.map((p) => [p.name, num(p.sold), num(p.returned), num(p.short), num(p.damaged), rs(p.value), pct(p.rate)])}
        />
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Shops with the most credit notes">
          <Table
            head={["Shop", "Credited", "Sales", "Rate"]}
            align={["l", "r", "r", "r"]}
            rows={r.shops.map((s) => [
              <Link key={s.retailerId} href={`/admin/reports/shops/${s.retailerId}`} className="hover:text-[var(--accent-text)]">
                {s.outletName}
              </Link>,
              rs(s.credited),
              rs(s.sales),
              pct(s.rate),
            ])}
          />
        </Section>
        <Section title="Reasons written on credit notes">
          <ShareBars rows={r.reasons.map((x) => ({ label: x.reason, value: x.value, note: `${x.count}` }))} />
        </Section>
      </div>
    </div>
  );
}
