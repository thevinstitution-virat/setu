import { Suspense } from "react";
import { duesPage } from "@/lib/dues-page";
import { ErrorCard, Kpi } from "@/components/reports/Kit";
import DuesToolbar from "@/components/reports/DuesToolbar";
import { AgentBlocks, BillsTable, CompanyBlocks, PartyBlocks } from "@/components/reports/DuesViews";
import { formatINR } from "@/lib/money";
import { count, shortDate, type DueBill } from "@/lib/dues-reports";

const inr = (p: number) => formatINR(p, { whole: true });

/** Outstanding as on a day: bill-wise (old to new), party-wise with collections, or salesman-wise. */
export default async function OutstandingReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const d = await duesPage(searchParams);
  if (!d.ok) return <ErrorCard message={d.error} />;
  const r = d.report;
  if (r.view === "collections") return null;

  // Company-wise counts each company's share of a bill; the others the whole bill.
  const lines: { bill: DueBill; balance: number }[] =
    r.view === "companies"
      ? r.companies.flatMap((c) => c.rows.map((x) => ({ bill: x.bill, balance: x.share.balance })))
      : (r.view === "bills" ? r.bills : r.view === "parties" ? r.parties.flatMap((p) => p.bills) : r.agents.flatMap((a) => a.parties.flatMap((p) => p.bills))).map((b) => ({ bill: b, balance: b.balance }));
  const bills = [...new Map(lines.map((l) => [l.bill.id, l.bill])).values()];
  const overdue = lines.filter((l) => l.bill.overdueDays > 0).reduce((s, l) => s + l.balance, 0);
  const over30 = lines.filter((l) => l.bill.overdueDays > 30).reduce((s, l) => s + l.balance, 0);
  const parties = new Set(bills.map((b) => b.shop.id)).size;
  const advance = r.view === "parties" || r.view === "agents" ? r.advance : null;

  return (
    <div className="space-y-4">
      <Suspense fallback={<div className="h-24" />}>
        <DuesToolbar view={r.view} options={d.options} today={d.today} summary={d.summary} file={d.file} />
      </Suspense>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label={`Outstanding as on ${shortDate(r.asOn)}`} value={inr(r.totals.balance)} sub={`${count(bills.length, "bill")} · ${count(parties, "party", "parties")}`} />
        <Kpi label="Past due date" value={inr(overdue)} sub={`${inr(over30)} more than 30 days late`} />
        <Kpi label="Billed on these bills" value={inr(r.totals.amount)} sub={`${inr(r.totals.received)} received so far`} />
        <Kpi label="Advance not yet used" value={advance === null ? "–" : inr(advance)} sub={advance === null ? "See party-wise" : "Paid ahead, not set against a bill"} />
      </div>
      {d.filters && <p className="text-xs text-[var(--muted)]">{d.filters}</p>}
      {r.view === "bills" && <BillsTable bills={r.bills} totals={r.totals} />}
      {r.view === "parties" && <PartyBlocks parties={r.parties} />}
      {r.view === "agents" && <AgentBlocks agents={r.agents} />}
      {r.view === "companies" && <CompanyBlocks companies={r.companies} totals={r.totals} />}
      <p className="text-xs text-[var(--muted)]">
        Payments are set against the oldest bills first. For a past date, only money received by that day counts. The salesman is the one on the bill, else the shop&apos;s own agent. Company-wise splits each bill by its products&apos; companies (GST included), and its payments in the same proportion.
      </p>
    </div>
  );
}
