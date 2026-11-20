import Link from "next/link";
import { loadShop, reportContext } from "@/lib/reports";
import { CHURN_LABEL } from "@/lib/analytics";
import { MoneyError } from "@/lib/money-error";
import { ErrorCard, Kpi, Section, ShareBars, Table, num, pct, rs } from "@/components/reports/Kit";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" });

export default async function ShopReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const { id } = await params;
  let d;
  try {
    d = await loadShop(ctx.tenantId, id, ctx.period);
  } catch (e) {
    if (e instanceof MoneyError) return <ErrorCard message={e.message} />;
    throw e;
  }
  const s = d.summary;
  const qs = ctx.sp.toString() ? `?${ctx.sp}` : "";
  const maxMonth = Math.max(1, ...d.trend.map((t) => t.value));

  return (
    <div className="space-y-5">
      <div className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/admin/reports/shops${qs}`} className="text-xs font-bold text-[var(--kesar-text)]">
            ← All shops
          </Link>
          <h2 className="font-heading text-xl font-bold text-[var(--ink)] mt-1">{d.shop.outletName}</h2>
          <p className="text-xs text-[var(--muted)]">
            {d.shop.owner} · {d.shop.area}
            {d.shop.agent && ` · ${d.shop.agent}`}
            {d.shop.phone && ` · ${d.shop.phone}`}
          </p>
        </div>
        <div className="flex gap-2">
          {s && <span className="chip chip-mor">{CHURN_LABEL[s.risk]}</span>}
          <Link href={`/admin/khata/${d.shop.id}`} className="btn btn-outline btn-sm">
            Khata
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Bought in the period" value={rs(s?.value ?? 0)} change={s?.change ?? null} sub={`${num(s?.orders ?? 0)} orders`} />
        <Kpi label="Average order" value={s?.orders ? rs(s.avgOrder) : "–"} />
        <Kpi label="Orders a month" value={s ? String(s.perMonth) : "–"} sub={s?.usualGap ? `usually every ${s.usualGap} days` : undefined} />
        <Kpi label="Last order" value={s?.daysSince === null || !s ? "–" : s.daysSince === 0 ? "Today" : `${s.daysSince} days ago`} sub={s?.lastOrder ?? undefined} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Month by month" sub="Orders in the last 180 days, empty months included">
          {d.trend.length ? (
            <ul className="space-y-2">
              {d.trend.map((t) => (
                <li key={t.month} className="grid grid-cols-[4rem_1fr_auto] items-center gap-3 text-sm" title={`${monthLabel(t.month)}: ${rs(t.value)} from ${t.orders} orders`}>
                  <span className="text-[var(--muted)]">{monthLabel(t.month)}</span>
                  <span className="h-2 rounded-full bg-black/5">
                    <span className="block h-2 rounded-full bg-mor" style={{ width: `${(t.value / maxMonth) * 100}%` }} />
                  </span>
                  <span className="tabular-nums font-semibold">
                    {rs(t.value)} <span className="text-xs font-normal text-[var(--muted)]">{t.orders}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">No orders in the last 6 months.</p>
          )}
        </Section>
        <Section title="Money" sub={d.shop.creditLimit ? `Credit limit ${rs(d.shop.creditLimit)}` : undefined}>
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Owes now" value={rs(d.money.outstanding)} sub={d.money.overdue ? `${rs(d.money.overdue)} overdue` : "nothing overdue"} />
            <Kpi label="Credit notes" value={rs(d.returns.value)} sub={`${d.returns.notes} note${d.returns.notes === 1 ? "" : "s"} · ${pct(d.returns.rate)} of sales`} />
          </div>
          <ShareBars rows={d.money.ageing.filter((a) => a.amount).map((a) => ({ label: a.label, value: a.amount }))} />
          <p className="text-xs text-[var(--muted)]">{d.visits} visits in the period.</p>
        </Section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="What they buy, by category">
          <ShareBars rows={d.mix.categories.map((c) => ({ label: c.name, value: c.taxable, note: `${c.share}%` }))} />
        </Section>
        <Section title="Top products">
          <Table head={["Product", "Qty", "Value", "Share"]} align={["l", "r", "r", "r"]} rows={d.mix.products.map((p) => [p.name, num(p.qty), rs(p.taxable), pct(p.share)])} />
        </Section>
      </div>
    </div>
  );
}
