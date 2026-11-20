import Link from "next/link";
import { loadReport, reportContext } from "@/lib/reports";
import { Empty, ErrorCard, Kpi, Section, Table, dayLabel, num, pct } from "@/components/reports/Kit";
import { fileUrl } from "@/components/store/format";

const SOURCE = { manual: "Typed", ai: "AI", ai_edited: "AI, corrected" } as Record<string, string>;

/** A10: shelf audits — the latest per shop in the period, our share of facings and empty slots. */
export default async function ShelfReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await reportContext(searchParams);
  if (!ctx.ok) return <ErrorCard message={ctx.error} />;
  const r = await loadReport(ctx.tenantId, "shelf", ctx.period);

  if (!r.audits) {
    return (
      <Section title="Shelf audits">
        <Empty>No shelf audits in this period. Sales agents add them from a shop&apos;s page during a visit: a photo of the shelf, then our facings, other brands&apos; and empty slots.</Empty>
      </Section>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Our share of the shelf" value={pct(r.avgShare)} sub="average over shops, latest audit each" />
        <Kpi label="Shops audited" value={num(r.shops)} sub={`${num(r.audits)} audits`} />
        <Kpi label="Empty slots" value={num(r.emptySlots)} sub={`at ${num(r.shopsWithEmpty)} shops`} />
        <Kpi label="Photos flagged" value={num(r.rows.filter((x) => x.flagged).length)} sub="same photo used before" />
      </div>
      <Section title="Shops, lowest share first" sub="Share = our facings ÷ (ours + other brands'), against the audit before">
        <Table
          head={["Shop", "Audited", "Ours", "Others", "Empty", "Share", "Change", "Photo"]}
          align={["l", "l", "r", "r", "r", "r", "r", "l"]}
          rows={r.rows.map((s) => [
            <span key="n" className="block min-w-0">
              <Link href={`/admin/reports/shops/${s.retailerId}`} className="font-semibold hover:text-[var(--kesar-text)]">
                {s.outletName}
              </Link>
              <span className="block text-xs text-[var(--muted)]">{s.area}</span>
            </span>,
            <span key="a" className="block text-xs">
              {dayLabel(s.day)} · {s.by}
              <span className="block text-[var(--muted)]">{SOURCE[s.source] ?? s.source}</span>
            </span>,
            num(s.ours),
            num(s.others),
            s.empty ? <span key="e" className="font-semibold text-[var(--kesar-text)]">{num(s.empty)}</span> : "0",
            pct(s.share),
            s.change === null ? (
              "–"
            ) : (
              <span key="c" className={`text-xs font-bold ${s.change === 0 ? "text-[var(--muted)]" : s.change > 0 ? "text-[var(--mint-text)]" : "text-[#a8281e]"}`}>
                {s.change === 0 ? "→ same" : `${s.change > 0 ? "▲" : "▼"} ${Math.abs(s.change)} pts`}
              </span>
            ),
            <a key="p" href={fileUrl(s.photoKey)} target="_blank" rel="noopener noreferrer" className="text-sm text-[var(--kesar-text)] underline">
              {s.flagged ? "Open · used before" : "Open"}
            </a>,
          ])}
        />
      </Section>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Audits by person">
          <Table head={["Person", "Audits", "Shops"]} align={["l", "r", "r"]} rows={r.people.map((p) => [p.name, num(p.audits), num(p.shops)])} />
        </Section>
        <Section title="Our products seen on shelves" sub="Shops where the AI or the agent marked it">
          {r.seen.length ? <Table head={["Product", "Shops"]} align={["l", "r"]} rows={r.seen.map((p) => [p.name, num(p.shops)])} /> : <Empty>Nothing marked yet.</Empty>}
        </Section>
      </div>
    </div>
  );
}
