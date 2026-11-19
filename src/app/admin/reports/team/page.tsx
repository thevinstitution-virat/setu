import { loadReport, reportContext } from "@/lib/reports";
import { ErrorCard, Kpi, Section, Table, num, pct, rs } from "@/components/reports/Kit";

export default async function TeamReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const t = await loadReport(ctx.tenantId, "team", ctx.period);
  const visits = t.sales.reduce((a, s) => a + s.visits, 0);
  const productive = t.sales.reduce((a, s) => a + s.productive, 0);
  const delivered = t.drivers.reduce((a, d) => a + d.delivered, 0);
  const failed = t.drivers.reduce((a, d) => a + d.failed, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Booked by the sales team" value={rs(t.sales.reduce((a, s) => a + s.value, 0))} sub={`${num(t.sales.reduce((a, s) => a + s.orders, 0))} orders`} />
        <Kpi label="Visits" value={num(visits)} sub={visits ? `${Math.round((productive * 1000) / visits) / 10}% with an order` : undefined} />
        <Kpi label="Collected by the team" value={rs(t.sales.reduce((a, s) => a + s.collected, 0))} />
        <Kpi label="Drops by drivers" value={num(delivered)} sub={failed ? `${failed} not delivered` : undefined} />
      </div>
      <Section title="Sales team" sub={`Strike rate = visits that ended in an order. Target is the value target for ${t.month}.`}>
        <Table
          head={["Name", "Orders", "Value", "Visits", "Strike rate", "Shops", "Collected", "Target", "Achieved"]}
          align={["l", "r", "r", "r", "r", "r", "r", "r", "r"]}
          rows={t.sales.map((s) => [
            <span key={s.userId}>
              {s.name}
              <span className="block text-xs font-normal text-[var(--muted)]">{s.role === "SUPERVISOR" ? "Supervisor" : "Sales agent"}</span>
            </span>,
            num(s.orders),
            rs(s.value),
            num(s.visits),
            pct(s.strikeRate),
            num(s.shops),
            rs(s.collected),
            s.target ? rs(s.target.goal) : "–",
            s.target ? <Bar key="t" pctValue={s.target.pct} /> : "–",
          ])}
        />
      </Section>
      <Section title="Drivers" sub="On time = delivered on or before the promised day. Cash = cash they took from shops.">
        <Table
          head={["Name", "Delivered", "Not delivered", "Success", "On time", "Trips", "Cash"]}
          align={["l", "r", "r", "r", "r", "r", "r"]}
          rows={t.drivers.map((d) => [d.name, num(d.delivered), num(d.failed), pct(d.successRate), pct(d.onTimeRate), num(d.trips), rs(d.cash)])}
        />
      </Section>
    </div>
  );
}

function Bar({ pctValue }: { pctValue: number }) {
  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className="h-1.5 w-16 rounded-full bg-black/5 overflow-hidden" aria-hidden>
        <span className="block h-full rounded-full bg-mor" style={{ width: `${Math.min(100, pctValue)}%` }} />
      </span>
      {pctValue}%
    </span>
  );
}
