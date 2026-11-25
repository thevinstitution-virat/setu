import { Suspense } from "react";
import { duesPage } from "@/lib/dues-page";
import { ErrorCard, Kpi } from "@/components/reports/Kit";
import DuesToolbar from "@/components/reports/DuesToolbar";
import { CollectionsTable } from "@/components/reports/DuesViews";
import { formatINR } from "@/lib/money";
import { count, shortDate } from "@/lib/dues-reports";

const inr = (p: number) => formatINR(p, { whole: true });

/** Who paid what, by method, for a day or a range: the daily collection sheet. */
export default async function CollectionsReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await duesPage(searchParams, "collections");
  if (!d.ok) return <ErrorCard message={d.error} />;
  const r = d.report;
  if (r.view !== "collections") return null;
  const p = r.period;
  const when = p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} to ${shortDate(p.to)}`;

  return (
    <div className="space-y-4">
      <Suspense fallback={<div className="h-24" />}>
        <DuesToolbar view="collections" options={d.options} today={d.today} summary={d.summary} file={d.file} />
      </Suspense>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={`Collected, ${when}`} value={inr(r.totals.total)} sub={`${count(r.rows.length, "party", "parties")} · ${count(r.totals.count, "receipt")}`} />
        <Kpi label="Cash" value={inr(r.totals.byMethod.CASH)} />
        <Kpi label="Cheques" value={inr(r.totals.byMethod.CHEQUE)} sub="Received; a bounced cheque drops out" />
        <Kpi label="UPI, bank and online" value={inr(r.totals.byMethod.UPI + r.totals.byMethod.BANK + r.totals.byMethod.ONLINE)} sub={r.pending.count ? `${inr(r.pending.amount)} more waiting to be checked` : undefined} />
      </div>
      {d.filters && <p className="text-xs text-[var(--muted)]">{d.filters}</p>}
      <CollectionsTable rows={r.rows} totals={r.totals} />
      <p className="text-xs text-[var(--muted)]">Money received against dues, not wallet top-ups or credit notes. Cash short at handover is on the Cash page.</p>
    </div>
  );
}
