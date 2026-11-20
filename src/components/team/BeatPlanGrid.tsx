"use client";

import { useState } from "react";
import { ErrorBox, Field, Sheet, errText, send, useFetch } from "@/components/admin/AdminKit";
import { addDay } from "@/lib/field-math";
import { Loading, dayLabel, errorText } from "@/components/team/kit";

type PlanDay = { date: string; source: "plan" | "weekday" | null; beat: { id: string; name: string } | null; note: string | null };

const DAYS = 14;

/**
 * The next 14 days for one agent: each day shows the dated plan or the
 * weekday beat. Tap a day to set a beat, "No beat" with a note, or go back
 * to the weekday beat.
 */
export default function BeatPlanGrid({
  salesAgentId,
  agentName,
  beats,
  from,
}: {
  salesAgentId: string;
  agentName: string;
  beats: { id: string; name: string; active: boolean }[];
  from: string;
}) {
  const to = addDay(from, DAYS - 1);
  const { data, error, reload } = useFetch<{ days: PlanDay[] }>(
    `/api/beat-plans?salesAgentId=${encodeURIComponent(salesAgentId)}&from=${from}&to=${to}`
  );
  const [editing, setEditing] = useState<PlanDay | null>(null);

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {data.days.map((d) => (
          <button
            key={d.date}
            type="button"
            onClick={() => setEditing(d)}
            className={`rounded-xl border p-2 text-left min-h-[64px] min-w-0 transition hover:shadow ${
              d.source === "plan" ? "border-[var(--kesar)] bg-[var(--kesar-tint)]" : "border-[var(--line)] bg-white"
            }`}
          >
            <p className="text-[11px] font-bold text-[var(--muted)]">{dayLabel(d.date)}</p>
            <p className={`text-sm font-semibold truncate ${d.beat ? "" : "text-[var(--muted)]"}`}>
              {d.beat ? d.beat.name : d.source === "plan" ? "No beat" : "Nothing set"}
            </p>
            {d.note && <p className="text-[11px] text-[var(--ink-2)] truncate">{d.note}</p>}
            {d.source === "plan" && <p className="text-[10.5px] font-bold text-[var(--kesar-text)]">Changed</p>}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)]">Orange days are changed from the usual weekday beat.</p>

      {editing && (
        <DaySheet
          day={editing}
          agentId={salesAgentId}
          agentName={agentName}
          beats={beats}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function DaySheet({
  day,
  agentId,
  agentName,
  beats,
  onClose,
  onSaved,
}: {
  day: PlanDay;
  agentId: string;
  agentName: string;
  beats: { id: string; name: string; active: boolean }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // "" = no beat; "clear" = back to the weekday beat; else a beat id.
  const [choice, setChoice] = useState<string>(day.beat?.id ?? "");
  const [note, setNote] = useState(day.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usable = beats.filter((b) => b.active || b.id === day.beat?.id);

  async function save() {
    setBusy(true);
    setError(null);
    const entry = choice === "clear" ? { date: day.date, clear: true } : { date: day.date, beatId: choice || null, note: note.trim() || null };
    try {
      await send("/api/beat-plans", "POST", { salesAgentId: agentId, entries: [entry] });
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  const options: { key: string; label: string; hint?: string }[] = [
    ...usable.map((b) => ({ key: b.id, label: b.name })),
    { key: "", label: "No beat", hint: "Meeting, training, office day" },
    ...(day.source === "plan" ? [{ key: "clear", label: "Usual weekday beat", hint: "Remove the change for this day" }] : []),
  ];

  return (
    <Sheet
      title={dayLabel(day.date, true)}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className={errorText}>{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet !min-h-[44px]" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar !min-h-[44px]" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save day"}
            </button>
          </div>
        </div>
      }
    >
      <p className="text-sm text-[var(--ink-2)]">
        Beat for <b>{agentName}</b> on this day.
      </p>
      <div className="space-y-2" role="radiogroup" aria-label="Beat for the day">
        {options.map((o) => (
          <label
            key={o.key || "none"}
            className={`flex items-start gap-3 rounded-2xl border p-3 min-h-[44px] cursor-pointer ${
              choice === o.key ? "border-mor bg-[var(--mint-tint)]" : "border-[var(--line)] bg-white"
            }`}
          >
            <input
              type="radio"
              name="beat-choice"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mor)]"
              checked={choice === o.key}
              onChange={() => setChoice(o.key)}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{o.label}</span>
              {o.hint && <span className="block text-xs text-[var(--muted)]">{o.hint}</span>}
            </span>
          </label>
        ))}
        {usable.length === 0 && <p className="text-xs text-[var(--muted)]">This agent has no beats yet. Make one first.</p>}
      </div>
      {choice !== "clear" && (
        <Field label="Note (optional)">
          <input
            className="input"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={choice ? "e.g. Cover the new shops on Station Road" : "e.g. Training at the office"}
          />
        </Field>
      )}
    </Sheet>
  );
}
