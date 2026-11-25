"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { TICKET_CATEGORIES, type SupportSettings as SupportRules, type TicketCategory } from "@/lib/engage-settings";
import { Field } from "@/components/admin/AdminKit";

type Form = {
  sla: Record<TicketCategory, string>;
  autoCloseDays: string;
  feedbackDays: string;
  lowRating: string;
};

const CATS = Object.keys(TICKET_CATEGORIES) as TicketCategory[];

function toForm(s: SupportRules): Form {
  const sla = {} as Record<TicketCategory, string>;
  for (const c of CATS) {
    const v = s.slaHours[c];
    sla[c] = typeof v === "number" && v > 0 ? String(v) : "";
  }
  return { sla, autoCloseDays: String(s.autoCloseDays), feedbackDays: String(s.feedbackDays), lowRating: String(s.lowRating) };
}

const trimmed = (f: Form): Form => ({
  sla: Object.fromEntries(CATS.map((c) => [c, f.sla[c].trim()])) as Record<TicketCategory, string>,
  autoCloseDays: f.autoCloseDays.trim(),
  feedbackDays: f.feedbackDays.trim(),
  lowRating: f.lowRating,
});

/** Whole number between min and max, or an error message. */
function wholeIn(s: string, min: number, max: number, what: string): number | string {
  const t = s.trim();
  const n = Number(t);
  if (!t || !Number.isInteger(n) || n < min || n > max) return `${what} must be a whole number from ${min} to ${max}`;
  return n;
}

/** Only the changed parts as the API's `support` patch, or an error message. */
function toPatch(f: Form, was: Form): Partial<SupportRules> | string {
  const out: Partial<SupportRules> = {};
  const t = trimmed(f);
  if (JSON.stringify(t.sla) !== JSON.stringify(was.sla)) {
    // The API keeps this map whole: send every type that has its own hours; blank ones use the default.
    const sla: SupportRules["slaHours"] = {};
    for (const c of CATS) {
      if (!t.sla[c]) continue;
      const v = wholeIn(t.sla[c], 1, 720, `Hours for ${TICKET_CATEGORIES[c].label.toLowerCase()}`);
      if (typeof v === "string") return v;
      sla[c] = v;
    }
    out.slaHours = sla;
  }
  const nums = [
    ["autoCloseDays", 1, 30, "Close resolved complaints after"],
    ["feedbackDays", 1, 30, "Days to rate a delivery"],
  ] as const;
  for (const [k, min, max, label] of nums) {
    if (t[k] === was[k]) continue;
    const v = wholeIn(t[k], min, max, label);
    if (typeof v === "string") return v;
    out[k] = v;
  }
  if (t.lowRating !== was.lowRating) out.lowRating = Number(t.lowRating);
  return out;
}

export default function SupportSettings({ support }: { support: SupportRules }) {
  const [saved, setSaved] = useState(() => toForm(support));
  const [f, setF] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = JSON.stringify(trimmed(f)) !== JSON.stringify(saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };
  const setSla = (c: TicketCategory, v: string) => {
    setF((prev) => ({ ...prev, sla: { ...prev.sla, [c]: v.replace(/\D/g, "").slice(0, 3) } }));
    setError(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch = toPatch(f, saved);
    if (typeof patch === "string") return setError(patch);
    if (!Object.keys(patch).length) return setF(saved);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ support: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      if (data.support) {
        const next = toForm(data.support);
        setSaved(next);
        setF(next);
      }
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const low = Number(f.lowRating);

  return (
    <form onSubmit={save} className="space-y-5">
      <div id="complaints" className="pt-4 scroll-mt-20">
        <p className="page-kick">Complaints</p>
        <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">Complaints and delivery ratings</h2>
        <p className="text-sm text-[var(--muted)] mt-1">How quickly complaints should be sorted out, and when a poor rating needs the office to look.</p>
      </div>

      <section className="card p-5 space-y-4">
        <div>
          <p className="font-heading font-bold">Hours to resolve</p>
          <p className="text-sm text-[var(--muted)] mt-1">
            The clock runs round the clock from when the shop raises the complaint. After that the office is told it is overdue. Leave a box blank to use
            the hours shown.
          </p>
        </div>
        <ul className="divide-y divide-[var(--line)]">
          {CATS.map((c) => (
            <li key={c} className="flex items-center justify-between gap-3 py-2.5">
              <label htmlFor={`sla-${c}`} className="text-sm font-medium min-w-0">
                {TICKET_CATEGORIES[c].label}
              </label>
              <span className="flex items-center gap-2 shrink-0">
                <input
                  id={`sla-${c}`}
                  className="input !w-20 text-right"
                  inputMode="numeric"
                  placeholder={String(TICKET_CATEGORIES[c].sla)}
                  value={f.sla[c]}
                  onChange={(e) => setSla(c, e.target.value)}
                />
                <span className="text-xs text-[var(--muted)] w-9">hours</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-[var(--muted)]">1 to 720 hours (30 days).</p>
      </section>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Closing and ratings</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Close resolved complaints after (days)" hint="Unless the shop reopens it first. 1 to 30.">
            <input className="input" inputMode="numeric" value={f.autoCloseDays} onChange={(e) => set("autoCloseDays", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Shops can rate a delivery for (days)" hint="Counted from the delivery. 1 to 30.">
            <input className="input" inputMode="numeric" value={f.feedbackDays} onChange={(e) => set("feedbackDays", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Tell the office about ratings of" hint="The office gets a notification for any rating this low or lower.">
            <select className="input" value={f.lowRating} onChange={(e) => set("lowRating", e.target.value)}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={String(n)}>
                  {n === 1 ? "1 star only" : `${n} stars or less`}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="rounded-xl bg-ink/5 px-3 py-2 text-sm text-[var(--ink-2)] flex items-center gap-1.5">
          <Icon name="star" className="h-4 w-4 shrink-0" />
          <span>
            A rating of {low === 1 ? "1 star" : `1 to ${low} stars`} alerts the office. {low < 4 ? `${low + 1} stars and up do not.` : "Only 5 stars does not."}
          </span>
        </p>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[var(--risk-text)]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">Unsaved complaint changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--success-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">Complaint settings saved.</span>
            )}
          </p>
          <div className="flex gap-2">
            {dirty && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy}
                onClick={() => {
                  setF(saved);
                  setError(null);
                }}
              >
                Undo
              </button>
            )}
            <button type="submit" className="btn btn-kesar btn-sm" disabled={!dirty || busy}>
              {busy ? "Saving…" : dirty ? "Save complaint settings" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
