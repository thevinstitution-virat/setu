"use client";

import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import { Field, SearchPick, Sheet, Toggle, api, errText, send, type Option } from "@/components/admin/AdminKit";
import { errorText } from "@/components/team/kit";

export type BeatJson = {
  id: string;
  name: string;
  weekdays: number[];
  active: boolean;
  area: { id: string; name: string };
  salesAgent: { id: string; user: { id: string; name: string } };
  shops: { seq: number; retailer: { id: string; outletName: string; pinCode: string } }[];
};

export type Agent = { salesAgentId: string; name: string };

type Shop = { id: string; outletName: string; sub: string };
type ShopHit = { id: string; outletName: string; pinCode: string; area: string; phone: string | null; mine: boolean };

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** New or edit beat: name, agent, area, usual days and shops in visiting order. */
export default function BeatSheet({
  beat,
  agents,
  areas,
  agentId: defaultAgent,
  onClose,
  onSaved,
}: {
  beat: BeatJson | null;
  agents: Agent[];
  areas: Option[];
  agentId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(beat?.name ?? "");
  const [agentId, setAgentId] = useState(beat?.salesAgent.id ?? defaultAgent ?? (agents.length === 1 ? agents[0].salesAgentId : ""));
  const [areaId, setAreaId] = useState<string | null>(beat?.area.id ?? null);
  const [days, setDays] = useState<number[]>(beat?.weekdays ?? []);
  const [active, setActive] = useState(beat?.active ?? true);
  const [shops, setShops] = useState<Shop[]>(
    (beat?.shops ?? []).map((s) => ({ id: s.retailer.id, outletName: s.retailer.outletName, sub: `PIN ${s.retailer.pinCode}` }))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Shop search (debounced, from the change handler).
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ShopHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  // Agents list may not hold the beat's agent (moved out of the team): keep it pickable.
  const agentList = beat && !agents.some((a) => a.salesAgentId === beat.salesAgent.id) ? [...agents, { salesAgentId: beat.salesAgent.id, name: beat.salesAgent.user.name }] : agents;
  const areaList = beat && !areas.some((a) => a.id === beat.area.id) ? [...areas, { id: beat.area.id, label: beat.area.name }] : areas;

  function search(text: string) {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    const t = text.trim();
    if (!t) {
      setHits(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      try {
        const d = await api<{ shops: ShopHit[] }>(`/api/field/shops?q=${encodeURIComponent(t)}`);
        if (mine !== seq.current) return;
        setHits(d.shops);
        setSearchError(null);
      } catch (e) {
        if (mine === seq.current) setSearchError(errText(e));
      } finally {
        if (mine === seq.current) setSearching(false);
      }
    }, 300);
  }

  const inList = new Set(shops.map((s) => s.id));

  function move(i: number, by: number) {
    setShops((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function toggleDay(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()));
  }

  async function save() {
    if (!name.trim()) return setError("Name the beat");
    if (!agentId) return setError("Pick the sales agent");
    if (!areaId) return setError("Pick the area");
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), salesAgentId: agentId, areaId, weekdays: days, retailerIds: shops.map((s) => s.id), active };
    try {
      await (beat ? send(`/api/beats/${beat.id}`, "PATCH", body) : send("/api/beats", "POST", body));
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={beat ? "Edit beat" : "New beat"}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className={errorText}>{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet !min-h-[44px]" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar !min-h-[44px]" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save beat"}
            </button>
          </div>
        </div>
      }
    >
      <Field label="Beat name">
        <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Market Road, Monday" />
      </Field>

      <Field label="Sales agent">
        {agentList.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No sales agents in your team.</p>
        ) : (
          <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Pick an agent</option>
            {agentList.map((a) => (
              <option key={a.salesAgentId} value={a.salesAgentId}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div>
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Area</span>
        <SearchPick options={areaList} value={areaId} onChange={setAreaId} placeholder="Search areas" />
      </div>

      <div>
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Usual days</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Usual days">
          {WEEKDAYS.map((w, d) => (
            <button
              key={w}
              type="button"
              aria-pressed={days.includes(d)}
              onClick={() => toggleDay(d)}
              className={`min-h-[44px] min-w-[44px] rounded-xl px-2.5 text-sm font-bold transition ${
                days.includes(d) ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "bg-ink/5 text-[var(--ink-2)]"
              }`}
            >
              {w}
            </button>
          ))}
        </div>
        {days.length === 0 && <p className="text-xs text-[var(--muted)] mt-1">No usual day: plan it day by day below the beats.</p>}
      </div>

      {beat && <Toggle checked={active} onChange={setActive} label="In use" hint="Turned off beats are never picked for a weekday." />}

      <div className="space-y-2">
        <span className="block text-sm font-medium text-[var(--ink-2)]">Shops in visiting order ({shops.length})</span>
        {shops.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No shops yet. Search below to add them.</p>
        ) : (
          <ol className="rounded-2xl border border-[var(--line)] bg-white divide-y divide-[var(--line)]">
            {shops.map((s, i) => (
              <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 min-w-0">
                <span className="w-6 text-center text-xs font-bold text-[var(--muted)] shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{s.outletName}</p>
                  {s.sub && <p className="text-xs text-[var(--muted)] truncate">{s.sub}</p>}
                </div>
                <button
                  type="button"
                  className="btn btn-quiet btn-xs !px-2 !min-h-[44px] !min-w-[40px] shrink-0"
                  aria-label={`Move ${s.outletName} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon name="chevronLeft" className="h-4 w-4 rotate-90" />
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-xs !px-2 !min-h-[44px] !min-w-[40px] shrink-0"
                  aria-label={`Move ${s.outletName} down`}
                  disabled={i === shops.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon name="chevronRight" className="h-4 w-4 rotate-90" />
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-xs !px-2 !min-h-[44px] !min-w-[40px] shrink-0"
                  aria-label={`Remove ${s.outletName}`}
                  onClick={() => setShops((list) => list.filter((x) => x.id !== s.id))}
                >
                  <Icon name="x" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="space-y-1.5">
          <input
            className="input"
            type="search"
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder="Search shops by name, PIN, phone or area"
            aria-label="Search shops to add"
          />
          {searching && <p className="text-xs text-[var(--muted)]">Searching…</p>}
          {searchError && <p className={errorText}>{searchError}</p>}
          {hits && !searching && (
            <div className="rounded-2xl border border-[var(--line)] bg-white max-h-72 overflow-y-auto divide-y divide-[var(--line)]">
              {hits.filter((h) => !inList.has(h.id)).length === 0 ? (
                <p className="px-3 py-2 text-sm text-[var(--muted)]">{hits.length ? "All matching shops are on the beat" : "No shop matches"}</p>
              ) : (
                hits
                  .filter((h) => !inList.has(h.id))
                  .map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 min-h-[44px] text-left hover:bg-black/[0.04]"
                      onClick={() => setShops((list) => [...list, { id: h.id, outletName: h.outletName, sub: [h.area, `PIN ${h.pinCode}`].filter(Boolean).join(" · ") }])}
                    >
                      <Icon name="plus" className="h-4 w-4 shrink-0 text-[var(--accent-text)]" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{h.outletName}</span>
                        <span className="block text-xs text-[var(--muted)] truncate">
                          {[h.area, `PIN ${h.pinCode}`, h.phone].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                    </button>
                  ))
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}
