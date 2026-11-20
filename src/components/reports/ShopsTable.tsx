"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatINR } from "@/lib/money";
import type { ChurnRisk, RetailerRow } from "@/lib/analytics";

const RISK: Record<ChurnRisk, { label: string; cls: string; icon: string }> = {
  high: { label: "At risk", cls: "bg-[#fde2df] text-[#8f1f15]", icon: "▼" },
  medium: { label: "Slipping", cls: "bg-[var(--genda-tint)] text-[var(--genda-text)]", icon: "◆" },
  low: { label: "Regular", cls: "bg-[var(--mint-tint)] text-[var(--mint-text)]", icon: "●" },
  new: { label: "New", cls: "bg-[#e1eeec] text-mor", icon: "★" },
  none: { label: "No orders yet", cls: "bg-black/5 text-foreground/60", icon: "○" },
};
const FILTERS: ("all" | ChurnRisk)[] = ["all", "high", "medium", "low", "new", "none"];
const SORTS = [
  { key: "value", label: "Sales" },
  { key: "risk", label: "Risk" },
  { key: "since", label: "Days since order" },
  { key: "change", label: "Change" },
  { key: "owed", label: "Outstanding" },
  { key: "name", label: "Name" },
] as const;
type Sort = (typeof SORTS)[number]["key"];
const ORDER: Record<ChurnRisk, number> = { high: 0, medium: 1, new: 2, low: 3, none: 4 };
const rs = (p: number) => formatINR(p, { whole: true });

/** Shop list with risk chips, search and sort. Rhythm comes from the last 180 days. */
export default function ShopsTable({ rows, counts, query }: { rows: RetailerRow[]; counts: Record<ChurnRisk, number>; query: string }) {
  const [filter, setFilter] = useState<"all" | ChurnRisk>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("value");

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = rows.filter((r) => (filter === "all" || r.risk === filter) && (!s || r.outletName.toLowerCase().includes(s) || r.area.toLowerCase().includes(s) || (r.agent ?? "").toLowerCase().includes(s)));
    const by: Record<Sort, (a: RetailerRow, b: RetailerRow) => number> = {
      value: (a, b) => b.value - a.value,
      risk: (a, b) => ORDER[a.risk] - ORDER[b.risk] || b.prevValue - a.prevValue,
      since: (a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1),
      change: (a, b) => (a.change ?? 0) - (b.change ?? 0),
      owed: (a, b) => b.outstanding - a.outstanding,
      name: (a, b) => a.outletName.localeCompare(b.outletName),
    };
    return [...out].sort(by[sort]);
  }, [rows, filter, q, sort]);

  return (
    <section className="card overflow-hidden">
      <div className="p-4 space-y-3 border-b border-[var(--line)]">
        <div>
          <h2 className="font-heading font-bold">Every shop</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">Risk compares days since the last order with the shop&apos;s own usual gap (last 180 days): 1.8× is slipping, 3× is at risk.</p>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${filter === f ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/60"}`}>
              {f === "all" ? "All" : RISK[f].label}
              <span className="ml-1 opacity-70">{f === "all" ? rows.length : counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input flex-1" type="search" placeholder="Search shop, area or agent" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input !w-auto" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="text-xs text-[var(--muted)] border-b border-[var(--line)]">
              <th className="px-4 py-2 text-left font-semibold">Shop</th>
              <th className="px-2 py-2 text-right font-semibold">Orders</th>
              <th className="px-2 py-2 text-right font-semibold">Sales</th>
              <th className="px-2 py-2 text-right font-semibold">Avg order</th>
              <th className="px-2 py-2 text-right font-semibold">Change</th>
              <th className="px-2 py-2 text-right font-semibold">Usual gap</th>
              <th className="px-2 py-2 text-right font-semibold">Last order</th>
              <th className="px-2 py-2 text-left font-semibold">Risk</th>
              <th className="px-4 py-2 text-right font-semibold">Owes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {shown.map((r) => (
              <tr key={r.retailerId} className="hover:bg-black/[0.02]">
                <td className="px-4 py-2.5">
                  <Link href={`/admin/reports/shops/${r.retailerId}${query}`} className="font-medium text-[var(--ink)] hover:text-[var(--kesar-text)]">
                    {r.outletName}
                  </Link>
                  <span className="block text-xs text-[var(--muted)]">
                    {r.area}
                    {r.agent && ` · ${r.agent}`}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">{r.orders}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{rs(r.value)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{r.orders ? rs(r.avgOrder) : "–"}</td>
                <td className={`px-2 py-2.5 text-right tabular-nums ${r.change === null ? "text-[var(--muted)]" : r.change < 0 ? "text-[#a8281e]" : "text-[var(--mint-text)]"}`}>{r.change === null ? "–" : `${r.change > 0 ? "+" : ""}${r.change}%`}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{r.usualGap === null ? "–" : `${r.usualGap} d`}</td>
                <td className="px-2 py-2.5 text-right tabular-nums">{r.daysSince === null ? "–" : r.daysSince === 0 ? "Today" : `${r.daysSince} d ago`}</td>
                <td className="px-2 py-2.5">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${RISK[r.risk].cls}`}>
                    <span aria-hidden>{RISK[r.risk].icon}</span>
                    {RISK[r.risk].label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.outstanding ? rs(r.outstanding) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="p-4 text-sm text-[var(--muted)]">No shops match.</p>}
      </div>
    </section>
  );
}
