"use client";

import { useState } from "react";
import { Field, Flash, errText, send } from "@/components/admin/AdminKit";
import { ErrLine, Section, num, useIsOwner } from "./kit";
import type { TenantData } from "./tenant-types";

type Tri = "default" | "on" | "off";

const triOf = (v: boolean | null): Tri => (v === null ? "default" : v ? "on" : "off");
const OPTIONS: { v: Tri; label: string }[] = [
  { v: "default", label: "Plan" },
  { v: "on", label: "On" },
  { v: "off", label: "Off" },
];

/** Per-business module and limit overrides on top of the plan. */
export default function TenantOverrides({ data, onChanged }: { data: TenantData; onChanged: () => void }) {
  const owner = useIsOwner();
  const ov = data.tenant.overrides ?? {};
  const [features, setFeatures] = useState<Record<string, Tri>>(() => Object.fromEntries(data.modules.map((m) => [m.code, triOf(m.override)])));
  const [staff, setStaff] = useState(ov.limits?.staff !== undefined ? String(ov.limits.staff) : "");
  const [retailers, setRetailers] = useState(ov.limits?.retailers !== undefined ? String(ov.limits.retailers) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  async function save() {
    const lim = (s: string, label: string) => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a whole number, or blank for the plan's`);
      return n;
    };
    setError(null);
    setFlash(null);
    let limits;
    try {
      limits = { staff: lim(staff, "Staff limit"), retailers: lim(retailers, "Shops limit") };
    } catch (e) {
      setError(errText(e));
      return;
    }
    setBusy(true);
    try {
      await send(`/api/platform/tenants/${data.tenant.id}`, "PATCH", {
        overrides: {
          features: Object.fromEntries(Object.entries(features).map(([k, v]) => [k, v === "default" ? null : v === "on"])),
          limits,
        },
      });
      setFlash("Modules and limits saved");
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const limitText = (l: { limit: number | null; used: number }) => `${num(l.used)} used of ${l.limit === null ? "no limit" : num(l.limit)}`;

  return (
    <Section title="Modules and limits" sub={owner ? "Plan = what the plan gives. On or Off overrides the plan for this business only." : "What this business can use now."}>
      <ul className="divide-y divide-[var(--line)]">
        {data.modules.map((m) => (
          <li key={m.code} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${m.on ? "bg-[var(--mint)]" : "bg-ink/20"}`} aria-hidden="true" />
                <span className="font-mono">{m.code}</span>
                <span className="text-xs font-normal text-[var(--muted)]">{m.on ? "on now" : "off now"}</span>
              </p>
              <p className="text-xs text-[var(--muted)]">{m.label}</p>
            </div>
            {owner ? (
              <div className="inline-flex rounded-xl p-0.5 bg-ink/5" role="radiogroup" aria-label={m.code}>
                {OPTIONS.map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    role="radio"
                    aria-checked={features[m.code] === o.v}
                    onClick={() => setFeatures({ ...features, [m.code]: o.v })}
                    className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                      features[m.code] === o.v ? (o.v === "on" ? "bg-[var(--success-tint)] text-[var(--success-text)]" : o.v === "off" ? "bg-[var(--risk-tint)] text-[var(--risk-text)]" : "bg-white text-ink shadow-sm") : "text-[var(--muted)]"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              m.override !== null && <span className="text-xs font-semibold text-[var(--accent-text)]">override: {m.override ? "on" : "off"}</span>
            )}
          </li>
        ))}
      </ul>

      <div className="grid gap-3 sm:grid-cols-2">
        {owner ? (
          <>
            <Field label="Staff logins limit" hint={`${limitText(data.limits.staff)}. Blank = plan's.`}>
              <input className="input" type="number" min={0} step={1} value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="Plan's" />
            </Field>
            <Field label="Shops limit" hint={`${limitText(data.limits.retailers)}. Blank = plan's.`}>
              <input className="input" type="number" min={0} step={1} value={retailers} onChange={(e) => setRetailers(e.target.value)} placeholder="Plan's" />
            </Field>
          </>
        ) : (
          <>
            <p className="text-sm">
              <span className="font-semibold">Staff logins:</span> {limitText(data.limits.staff)}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Shops:</span> {limitText(data.limits.retailers)}
            </p>
          </>
        )}
      </div>

      {owner && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save modules and limits"}
          </button>
          <Flash text={flash} />
        </div>
      )}
      <ErrLine text={error} />
    </Section>
  );
}
