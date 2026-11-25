"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import type { FieldSettings as FieldRules } from "@/lib/field-settings";
import { Field, Toggle } from "@/components/admin/AdminKit";

type Form = {
  selfie: boolean;
  geo: boolean;
  trackLocation: boolean;
  pingMinutes: string;
  pingRetentionDays: string;
  workStart: string;
  visitRadiusM: string;
  offBeat: boolean;
};

const toForm = (s: FieldRules): Form => ({
  selfie: s.selfie,
  geo: s.geo,
  trackLocation: s.trackLocation,
  pingMinutes: String(s.pingMinutes),
  pingRetentionDays: String(s.pingRetentionDays),
  workStart: s.workStart,
  visitRadiusM: String(s.visitRadiusM),
  offBeat: s.offBeat,
});

const trimmed = (f: Form): Form => ({
  ...f,
  pingMinutes: f.pingMinutes.trim(),
  pingRetentionDays: f.pingRetentionDays.trim(),
  workStart: f.workStart.trim(),
  visitRadiusM: f.visitRadiusM.trim(),
});

/** Whole number between min and max, or an error message. */
function wholeIn(s: string, min: number, max: number, what: string): number | string {
  const t = s.trim();
  const n = Number(t);
  if (!t || !Number.isInteger(n) || n < min || n > max) return `${what} must be a whole number from ${min} to ${max}`;
  return n;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Only the changed fields as the API's `field` patch, or an error message. */
function toPatch(f: Form, was: Form): Partial<FieldRules> | string {
  const out: Partial<FieldRules> = {};
  for (const k of ["selfie", "geo", "trackLocation", "offBeat"] as const) if (f[k] !== was[k]) out[k] = f[k];
  const nums = [
    ["pingMinutes", 1, 60, "Minutes between positions"],
    ["pingRetentionDays", 7, 365, "Keep positions for (days)"],
    ["visitRadiusM", 25, 5000, "Visit distance warning"],
  ] as const;
  for (const [k, min, max, label] of nums) {
    if (f[k].trim() === was[k]) continue;
    const v = wholeIn(f[k], min, max, label);
    if (typeof v === "string") return v;
    out[k] = v;
  }
  if (f.workStart.trim() !== was.workStart) {
    if (!HHMM.test(f.workStart.trim())) return "Work starts at must be a time like 09:30";
    out.workStart = f.workStart.trim();
  }
  return out;
}

export default function FieldSettings({ field }: { field: FieldRules }) {
  const [saved, setSaved] = useState(() => toForm(field));
  const [f, setF] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = JSON.stringify(trimmed(f)) !== JSON.stringify(saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
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
        body: JSON.stringify({ field: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      if (data.field) {
        const next = toForm(data.field);
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

  return (
    <form onSubmit={save} className="space-y-5">
      <div id="field" className="pt-4 scroll-mt-20">
        <p className="page-kick">Field team</p>
        <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">Check-in, visits and positions</h2>
        <p className="text-sm text-[var(--muted)] mt-1">Rules for sales agents, drivers and supervisors when they check in and visit shops.</p>
      </div>

      <section className="card p-5 space-y-5">
        <div className="space-y-4">
          <Toggle
            checked={f.selfie}
            onChange={(v) => set("selfie", v)}
            label="Selfie to check in and out"
            hint="Staff take a photo of themselves when they start and end the day."
          />
          <Toggle
            checked={f.geo}
            onChange={(v) => set("geo", v)}
            label="Location to check in and out"
            hint="The phone's location is saved with each check-in and check-out."
          />
          <Toggle
            checked={f.offBeat}
            onChange={(v) => set("offBeat", v)}
            label="Sales agents can visit and order for any shop"
            hint="Off: they see only their own shops. Supervisors and admins can always visit any shop."
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 max-w-md">
          <Field label="Work starts at" hint="Check-ins after this time are marked late.">
            <input className="input" type="time" value={f.workStart} onChange={(e) => set("workStart", e.target.value)} />
          </Field>
          <Field label="Visit distance warning (metres)" hint="A visit checked in further than this from the shop is flagged. 25 to 5000.">
            <input className="input" inputMode="numeric" value={f.visitRadiusM} onChange={(e) => set("visitRadiusM", e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>

        <div className="border-t border-[var(--line)] pt-5 space-y-4">
          <Toggle
            checked={f.trackLocation}
            onChange={(v) => set("trackLocation", v)}
            label="Record positions while on duty"
            hint="Shows where your staff are and the route they took on the Field team screens."
          />
          <div className="rounded-2xl bg-[var(--scheme-tint)] p-3 text-xs text-[var(--ink-2)] flex items-start gap-2">
            <Icon name="alert" className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-bold">Tell your staff first.</p>
              <p>Positions are kept only while someone is on duty, never after they check out or go off duty.</p>
              <p>It needs the phone app open, or the Android app to keep recording in the background.</p>
            </div>
          </div>
          <div className={`grid gap-3 sm:grid-cols-2 max-w-md ${f.trackLocation ? "" : "opacity-60"}`}>
            <Field label="Minutes between positions" hint="1 to 60.">
              <input className="input" inputMode="numeric" value={f.pingMinutes} onChange={(e) => set("pingMinutes", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Keep positions for (days)" hint="Older positions are deleted every night. 7 to 365.">
              <input
                className="input"
                inputMode="numeric"
                value={f.pingRetentionDays}
                onChange={(e) => set("pingRetentionDays", e.target.value.replace(/\D/g, ""))}
              />
            </Field>
          </div>
        </div>

        <p className="text-xs text-[var(--muted)] flex items-start gap-1.5">
          <Icon name="pin" className="h-4 w-4 shrink-0" />
          <span>
            Add staff and set their supervisor in{" "}
            <Link href="/admin/team" className="font-semibold underline">
              Team
            </Link>
            . See who is out today in{" "}
            <Link href="/team" className="font-semibold underline">
              Field team
            </Link>
            .
          </span>
        </p>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[var(--risk-text)]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">Unsaved field team changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--success-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">Field team settings saved.</span>
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
              {busy ? "Saving…" : dirty ? "Save field settings" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
