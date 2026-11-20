"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, TabBar, useFetch } from "@/components/admin/AdminKit";
import { istMonth } from "@/lib/field-math";
import { METRIC_LABEL, MONEY_METRICS } from "@/lib/field-settings";
import { addMonth, monthText, rupees } from "./kit";

type Metric = keyof typeof METRIC_LABEL;

type Target = {
  id: string;
  userId: string;
  period: string;
  metric: Metric;
  goal: number;
  productId: string | null;
  brandId: string | null;
  incentive: number;
  minPct: number;
  capPct: number;
  note: string | null;
  achieved: number;
  pct: number;
  earned: number;
  itemName: string | null;
};

type Board = {
  period: string;
  metric: Metric;
  rows: { rank: number; userId: string; name: string; role: string; achieved: number; goal: number | null; pct: number | null }[];
  me: string;
};

const METRICS = (Object.keys(METRIC_LABEL) as Metric[]).map((k) => ({ key: k, label: METRIC_LABEL[k] }));

/** A metric amount as people say it: ₹ for money, units, shops. */
export function metricValue(metric: string, n: number) {
  if (MONEY_METRICS.has(metric)) return rupees(n);
  if (metric === "NEW_OUTLETS") return `${n.toLocaleString("en-IN")} shop${n === 1 ? "" : "s"}`;
  return `${n.toLocaleString("en-IN")} unit${n === 1 ? "" : "s"}`;
}

/** My targets for a month with progress and incentive, and the leaderboard. */
export default function TargetsCard() {
  const thisMonth = istMonth();
  const [period, setPeriod] = useState(thisMonth);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 min-h-[44px]"
          onClick={() => setPeriod((p) => addMonth(p, -1))}
          aria-label="Previous month"
        >
          <Icon name="chevronLeft" className="h-4 w-4" />
        </button>
        <p className="font-heading font-bold text-base">{monthText(period)}</p>
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 min-h-[44px]"
          onClick={() => setPeriod((p) => addMonth(p, 1))}
          disabled={period >= thisMonth}
          aria-label="Next month"
        >
          <Icon name="chevronRight" className="h-4 w-4" />
        </button>
      </div>
      <MyTargets key={`t-${period}`} period={period} />
      <Leaderboard key={`l-${period}`} period={period} />
    </div>
  );
}

function MyTargets({ period }: { period: string }) {
  const { data, error, reload } = useFetch<{ targets: Target[] }>(`/api/targets?mine=1&period=${period}`);

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <div className="card p-4 text-sm text-[var(--muted)]">Loading targets…</div>;
  if (!data.targets.length) {
    return (
      <div className="card p-6 text-center space-y-2">
        <span className="icon-tile mx-auto bg-[var(--genda-tint)] text-[var(--genda-text)]">
          <Icon name="chart" />
        </span>
        <p className="text-sm text-[var(--ink-2)]">No targets set for you this month.</p>
      </div>
    );
  }

  const earned = data.targets.reduce((a, t) => a + t.earned, 0);
  const possible = data.targets.reduce((a, t) => a + t.incentive, 0);

  return (
    <div className="space-y-3">
      {possible > 0 && (
        <div className="panel-dark p-5">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Incentive earned</p>
          <p className="stat-num mt-1">{rupees(earned)}</p>
          <p className="text-xs text-white/70 mt-1">Up to {rupees(possible)} at 100% of every target</p>
        </div>
      )}
      {data.targets.map((t) => {
        const width = Math.min(100, Math.max(0, t.pct));
        const done = t.pct >= 100;
        return (
          <div key={t.id} className="card p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-sm">{METRIC_LABEL[t.metric] ?? t.metric}</p>
                {t.itemName && <p className="text-xs text-[var(--muted)] truncate">{t.itemName}</p>}
              </div>
              <span className={`st ${done ? "st-delivered" : t.pct >= t.minPct ? "st-placed" : "st-out"} text-xs px-2.5 py-1 rounded-full shrink-0`}>
                {t.pct}%
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-black/[0.07] overflow-hidden" role="progressbar" aria-valuenow={width} aria-valuemin={0} aria-valuemax={100}>
              <div
                className={`h-full rounded-full ${done ? "bg-[var(--mint)]" : "bg-[var(--kesar)]"}`}
                style={{ width: `${width}%` }}
              />
            </div>
            <p className="text-sm">
              <span className="font-semibold">{metricValue(t.metric, t.achieved)}</span>
              <span className="text-[var(--muted)]"> of {metricValue(t.metric, t.goal)}</span>
            </p>
            {t.incentive > 0 && (
              <p className="text-xs text-[var(--muted)]">
                Incentive {rupees(t.earned)} of {rupees(t.incentive)}
                {t.minPct > 0 && ` · starts at ${t.minPct}%`}
                {t.capPct > 100 && ` · up to ${t.capPct}%`}
              </p>
            )}
            {t.note && <p className="text-xs text-[var(--ink-2)]">{t.note}</p>}
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ period }: { period: string }) {
  const [metric, setMetric] = useState<Metric>("VALUE");
  const { data, error, reload } = useFetch<Board>(`/api/targets/leaderboard?period=${period}&metric=${metric}`);
  const fresh = data && data.metric === metric ? data : null;
  const rows = fresh?.rows ?? [];
  const meRow = rows.find((r) => r.userId === fresh?.me);
  const top = rows.slice(0, 10);
  const showMe = meRow && meRow.rank > 10;

  return (
    <div className="card p-4 space-y-3">
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Leaderboard</p>
      <TabBar tabs={METRICS} value={metric} onChange={setMetric} />
      {error && !fresh ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !fresh ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Nobody to rank yet.</p>
      ) : (
        <ol className="space-y-1">
          {[...top, ...(showMe ? [meRow] : [])].map((r) => {
            const me = r.userId === fresh.me;
            return (
              <li
                key={r.userId}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 min-h-[44px] ${me ? "bg-[var(--genda-tint)]" : ""}`}
              >
                <span className={`w-7 text-center font-heading font-bold ${r.rank <= 3 ? "text-[var(--kesar-text)]" : "text-[var(--muted)]"}`}>
                  {r.rank}
                </span>
                <span className="flex-1 min-w-0 text-sm font-semibold truncate">
                  {r.name}
                  {me && <span className="text-xs font-bold text-[var(--genda-text)]"> (you)</span>}
                </span>
                <span className="text-sm font-bold shrink-0">{metricValue(metric, r.achieved)}</span>
                {r.pct !== null && <span className="text-xs text-[var(--muted)] w-10 text-right shrink-0">{r.pct}%</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
