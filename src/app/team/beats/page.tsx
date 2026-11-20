"use client";

import { useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { ActiveChip, ErrorBox, areaOptions, useFetch, type RegionRow } from "@/components/admin/AdminKit";
import { istDay } from "@/lib/field-math";
import BeatSheet, { WEEKDAYS, type Agent, type BeatJson } from "@/components/team/BeatSheet";
import BeatPlanGrid from "@/components/team/BeatPlanGrid";
import { Empty, Loading, plural, type Member } from "@/components/team/kit";

type Group = { agent: Agent; beats: BeatJson[] };

export default function TeamBeatsPage() {
  const beats = useFetch<{ beats: BeatJson[] }>("/api/beats");
  const members = useFetch<{ members: Member[] }>("/api/team/members");
  const regions = useFetch<{ regions: RegionRow[] }>("/api/regions");
  const [today] = useState(() => istDay());
  const [editing, setEditing] = useState<{ beat: BeatJson | null; agentId?: string } | null>(null);
  const [planFor, setPlanFor] = useState<string | null>(null);

  const agents: Agent[] = useMemo(
    () =>
      (members.data?.members ?? [])
        .filter((m) => m.salesAgentId)
        .map((m) => ({ salesAgentId: m.salesAgentId!, name: m.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members.data]
  );
  const areas = useMemo(() => areaOptions(regions.data?.regions), [regions.data]);

  const groups: Group[] = useMemo(() => {
    const list = beats.data?.beats ?? [];
    const out: Group[] = agents.map((a) => ({ agent: a, beats: list.filter((b) => b.salesAgent.id === a.salesAgentId) }));
    // Beats of agents no longer in the member list (inactive, moved): still show them.
    for (const b of list) {
      if (out.some((g) => g.agent.salesAgentId === b.salesAgent.id)) continue;
      out.push({ agent: { salesAgentId: b.salesAgent.id, name: b.salesAgent.user.name }, beats: list.filter((x) => x.salesAgent.id === b.salesAgent.id) });
    }
    return out;
  }, [beats.data, agents]);

  const error = beats.error ?? members.error ?? regions.error;
  const ready = beats.data && members.data && regions.data;

  function retry() {
    beats.reload();
    members.reload();
    regions.reload();
  }

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Field team</p>
          <h1 className="page-title">Beats</h1>
          <p className="page-sub">Which shops each sales agent visits, on which days.</p>
        </div>
        {ready && agents.length > 0 && (
          <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={() => setEditing({ beat: null })}>
            <Icon name="plus" className="h-4 w-4" /> New beat
          </button>
        )}
      </div>

      {error && <ErrorBox message={error} onRetry={retry} />}
      {!ready && !error && <Loading />}

      {ready &&
        (groups.length === 0 ? (
          <Empty title="No sales agents in your team yet" sub="Beats are for sales agents. Ask the office to put agents under you." />
        ) : (
          groups.map((g) => (
            <section key={g.agent.salesAgentId} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-heading font-bold text-xl truncate">{g.agent.name}</h2>
                  <p className="text-xs text-[var(--muted)]">{plural(g.beats.length, "beat")}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm !min-h-[44px]"
                    aria-expanded={planFor === g.agent.salesAgentId}
                    onClick={() => setPlanFor((cur) => (cur === g.agent.salesAgentId ? null : g.agent.salesAgentId))}
                  >
                    <Icon name="clock" className="h-4 w-4" /> {planFor === g.agent.salesAgentId ? "Hide plan" : "Next 14 days"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm !min-h-[44px]"
                    onClick={() => setEditing({ beat: null, agentId: g.agent.salesAgentId })}
                    aria-label={`New beat for ${g.agent.name}`}
                  >
                    <Icon name="plus" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {g.beats.length === 0 ? (
                <p className="card p-4 text-sm text-[var(--muted)]">No beats yet for {g.agent.name}.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {g.beats.map((b) => (
                    <BeatCard key={b.id} b={b} onEdit={() => setEditing({ beat: b })} />
                  ))}
                </div>
              )}

              {planFor === g.agent.salesAgentId && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">Plan for the next 14 days</p>
                  <BeatPlanGrid
                    salesAgentId={g.agent.salesAgentId}
                    agentName={g.agent.name}
                    beats={g.beats.map((b) => ({ id: b.id, name: b.name, active: b.active }))}
                    from={today}
                  />
                </div>
              )}
            </section>
          ))
        ))}

      {editing && (
        <BeatSheet
          beat={editing.beat}
          agentId={editing.agentId}
          agents={agents}
          areas={areas}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            beats.reload();
            // Plans show beat names: refresh an open grid by closing and reopening it.
            setPlanFor(null);
          }}
        />
      )}
    </div>
  );
}

function BeatCard({ b, onEdit }: { b: BeatJson; onEdit: () => void }) {
  return (
    <div className={`card p-4 space-y-2 min-w-0 ${b.active ? "" : "opacity-70"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading font-bold truncate">{b.name}</p>
          <p className="text-xs text-[var(--muted)] truncate">
            {b.area.name} · {plural(b.shops.length, "shop")}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ActiveChip active={b.active} on="In use" off="Off" />
          <button type="button" className="btn btn-quiet btn-xs !min-h-[44px]" onClick={onEdit} aria-label={`Edit ${b.name}`}>
            <Icon name="edit" className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {WEEKDAYS.map((w, d) => (
          <span
            key={w}
            className={`rounded-lg px-1.5 py-0.5 text-[11px] font-bold ${b.weekdays.includes(d) ? "bg-mor text-white" : "bg-ink/5 text-[var(--muted)]"}`}
          >
            {w}
          </span>
        ))}
      </div>
      {b.shops.length > 0 && (
        <p className="text-xs text-[var(--ink-2)] line-clamp-2">
          {b.shops
            .slice(0, 6)
            .map((s) => s.retailer.outletName)
            .join(" → ")}
          {b.shops.length > 6 ? ` … +${b.shops.length - 6}` : ""}
        </p>
      )}
    </div>
  );
}
