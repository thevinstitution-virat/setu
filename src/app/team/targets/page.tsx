"use client";

import { use, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, TabBar, errText, send, useFetch } from "@/components/admin/AdminKit";
import { istMonth } from "@/lib/field-math";
import { METRIC_LABEL, MONEY_METRICS } from "@/lib/field-settings";
import TargetSheet, { METRICS, type Metric, type TargetJson } from "@/components/team/TargetSheet";
import { Bar, Empty, Loading, MonthPicker, YM, errorText, monthLabel, roleText, rupees, setQuery, type Member } from "@/components/team/kit";

type Targets = { period: string; targets: TargetJson[]; canManage: boolean };
type Board = { period: string; metric: Metric; rows: { rank: number; userId: string; name: string; role: string; achieved: number; goal: number | null; pct: number | null }[]; me: string };

/** 123456 paise → "₹1,235"; 40 units → "40 units". */
function amount(metric: string, n: number) {
  if (MONEY_METRICS.has(metric)) return rupees(n);
  if (metric === "VOLUME") return `${n.toLocaleString("en-IN")} ${n === 1 ? "unit" : "units"}`;
  return `${n.toLocaleString("en-IN")} ${n === 1 ? "shop" : "shops"}`;
}

export default function TeamTargetsPage({ searchParams }: { searchParams: Promise<{ period?: string | string[] }> }) {
  const { period: initial } = use(searchParams);
  const [month, setMonth] = useState(() => (typeof initial === "string" && YM.test(initial) ? initial : istMonth()));
  const [metric, setMetric] = useState<Metric>("VALUE");
  const targets = useFetch<Targets>(`/api/targets?period=${month}`);
  const board = useFetch<Board>(`/api/targets/leaderboard?period=${month}&metric=${metric}`);
  const current = targets.data && targets.data.period === month ? targets.data : null;
  const ranking = board.data && board.data.period === month && board.data.metric === metric ? board.data : null;
  const canManage = !!targets.data?.canManage;
  const members = useFetch<{ members: Member[] }>(canManage ? "/api/team/members" : null);
  const [editing, setEditing] = useState<{ target: TargetJson | null } | null>(null);

  function goTo(m: string) {
    setMonth(m);
    setQuery(`/team/targets?period=${m}`);
  }

  const people = useMemo(() => {
    const map = new Map<string, { name: string; role: string; rows: TargetJson[] }>();
    for (const t of current?.targets ?? []) {
      const g = map.get(t.userId) ?? { name: t.user.name, role: t.user.role, rows: [] };
      g.rows.push(t);
      map.set(t.userId, g);
    }
    return [...map.entries()].map(([userId, g]) => ({ userId, ...g, earned: g.rows.reduce((s, r) => s + r.earned, 0) }));
  }, [current]);

  const totalEarned = people.reduce((s, p) => s + p.earned, 0);

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Field team</p>
          <h1 className="page-title">Targets</h1>
          <p className="page-sub">Monthly goals, how far each person has got, and the incentive earned.</p>
        </div>
        {canManage && (
          <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={() => setEditing({ target: null })} disabled={!members.data}>
            <Icon name="plus" className="h-4 w-4" /> New target
          </button>
        )}
      </div>

      <MonthPicker month={month} onChange={goTo} />
      {members.error && <p className={errorText}>{members.error}</p>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 className="font-heading font-bold text-xl">Progress</h2>
          {current && totalEarned > 0 && <p className="text-sm text-[var(--muted)]">Earned so far: {rupees(totalEarned)}</p>}
        </div>
        {targets.error && <ErrorBox message={targets.error} onRetry={targets.reload} />}
        {!current && !targets.error && <Loading />}
        {current &&
          (people.length === 0 ? (
            <Empty title={`No targets for ${monthLabel(month)}`} sub={canManage ? "Add one with New target." : "The office sets targets each month."} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {people.map((p) => (
                <div key={p.userId} className="card p-4 space-y-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-heading font-bold truncate">{p.name}</p>
                      <p className="text-xs text-[var(--muted)]">{roleText(p.role)}</p>
                    </div>
                    {p.earned > 0 && <span className="chip chip-mint !py-0.5 !px-2 !text-[11.5px] shrink-0">Earned {rupees(p.earned)}</span>}
                  </div>
                  <ul className="space-y-3">
                    {p.rows.map((t) => (
                      <TargetRow key={t.id} t={t} canManage={canManage} onEdit={() => setEditing({ target: t })} onDeleted={targets.reload} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-heading font-bold text-xl">Leaderboard</h2>
        <TabBar tabs={METRICS.map((m) => ({ key: m, label: METRIC_LABEL[m] }))} value={metric} onChange={setMetric} />
        {board.error && <ErrorBox message={board.error} onRetry={board.reload} />}
        {!ranking && !board.error && <Loading />}
        {ranking &&
          (ranking.rows.length === 0 ? (
            <Empty title="No one to rank yet" />
          ) : (
            <ol className="card divide-y divide-[var(--line)]">
              {ranking.rows.map((r) => (
                <li key={r.userId} className="flex items-center gap-3 p-3 min-w-0">
                  <span
                    className={`grid place-items-center h-9 w-9 rounded-full shrink-0 font-heading font-bold text-sm ${
                      r.rank <= 3 && r.achieved > 0 ? "bg-[var(--genda-tint)] text-[var(--genda-text)]" : "bg-ink/5 text-[var(--ink-2)]"
                    }`}
                  >
                    {r.rank}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <p className="text-sm font-bold shrink-0">{amount(metric, r.achieved)}</p>
                    </div>
                    {r.goal != null && r.pct != null ? (
                      <>
                        <Bar pct={r.pct} label={`${r.name}: ${r.pct}% of goal`} />
                        <p className="text-xs text-[var(--muted)]">
                          {r.pct}% of {amount(metric, r.goal)}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-[var(--muted)]">{roleText(r.role)} · no target set</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          ))}
      </section>

      {editing && members.data && (
        <TargetSheet
          target={editing.target}
          period={month}
          members={members.data.members}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            targets.reload();
            board.reload();
          }}
        />
      )}
    </div>
  );
}

function TargetRow({ t, canManage, onEdit, onDeleted }: { t: TargetJson; canManage: boolean; onEdit: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/targets/${t.id}`, "DELETE");
      onDeleted();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <li className="space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {METRIC_LABEL[t.metric]}
            {t.itemName ? <span className="text-[var(--muted)] font-normal"> · {t.itemName}</span> : null}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {amount(t.metric, t.achieved)} of {amount(t.metric, t.goal)}
          </p>
        </div>
        <p className={`font-heading font-bold shrink-0 ${t.pct >= 100 ? "text-[var(--mint-text)]" : ""}`}>{t.pct}%</p>
      </div>
      <Bar pct={t.pct} label={`${METRIC_LABEL[t.metric]} ${t.pct}%`} />
      <p className="text-xs text-[var(--ink-2)]">
        {t.incentive > 0 ? (
          <>
            Incentive {rupees(t.incentive)} at 100% · earned <b>{rupees(t.earned)}</b> · pays from {t.minPct}%, capped at {t.capPct}%
          </>
        ) : (
          "No incentive"
        )}
      </p>
      {t.note && <p className="text-xs text-[var(--muted)] break-words">{t.note}</p>}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {confirm ? (
            <>
              <span className="text-xs font-semibold">Delete this target?</span>
              <button type="button" className="btn btn-danger btn-xs !min-h-[44px]" disabled={busy} onClick={remove}>
                {busy ? "Deleting…" : "Yes, delete"}
              </button>
              <button type="button" className="btn btn-quiet btn-xs !min-h-[44px]" disabled={busy} onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-quiet btn-xs !min-h-[44px]" onClick={onEdit}>
                <Icon name="edit" className="h-3.5 w-3.5" /> Edit
              </button>
              <button type="button" className="btn btn-quiet btn-xs !min-h-[44px]" onClick={() => setConfirm(true)}>
                <Icon name="trash" className="h-3.5 w-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      )}
      {error && <p className={errorText}>{error}</p>}
    </li>
  );
}
