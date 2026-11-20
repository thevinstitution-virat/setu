"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, Field, Flash, Sheet, Toggle, errText, send, useFetch } from "@/components/admin/AdminKit";
import { ErrLine, StatusChip, inr, num, paiseToText, toPaiseText, useIsOwner } from "./kit";
import type { PlanRow } from "./tenant-types";

type Data = { plans: PlanRow[]; features: Record<string, string> };

type Form = {
  code: string;
  name: string;
  base: string;
  seat: string;
  retailer: string;
  aiCredits: string;
  aiCredit: string;
  features: string[];
  staff: string;
  retailers: string;
  trialDays: string;
  sortOrder: string;
  public: boolean;
  active: boolean;
};

const blank = (sortOrder: number): Form => ({
  code: "",
  name: "",
  base: "0",
  seat: "0",
  retailer: "0",
  aiCredits: "0",
  aiCredit: "0",
  features: [],
  staff: "",
  retailers: "",
  trialDays: "14",
  sortOrder: String(sortOrder),
  public: false,
  active: true,
});

function toForm(p: PlanRow): Form {
  return {
    code: p.code,
    name: p.name,
    base: paiseToText(p.basePaise),
    seat: paiseToText(p.seatPaise),
    retailer: paiseToText(p.retailerPaise),
    aiCredits: String(p.aiCredits),
    aiCredit: paiseToText(p.aiCreditPaise),
    features: [...p.features],
    staff: p.limits?.staff !== undefined ? String(p.limits.staff) : "",
    retailers: p.limits?.retailers !== undefined ? String(p.limits.retailers) : "",
    trialDays: String(p.trialDays),
    sortOrder: String(p.sortOrder),
    public: p.public,
    active: p.active,
  };
}

/** Form → API body, or an error message. */
function toBody(f: Form, creating: boolean): Record<string, unknown> | string {
  const money: [keyof Form, string, string][] = [
    ["base", "basePaise", "Monthly fee"],
    ["seat", "seatPaise", "Per staff login"],
    ["retailer", "retailerPaise", "Per active shop"],
    ["aiCredit", "aiCreditPaise", "Per extra AI credit"],
  ];
  const out: Record<string, unknown> = { name: f.name.trim(), features: f.features, public: f.public, active: f.active };
  if (creating) out.code = f.code.trim().toLowerCase();
  for (const [k, api, label] of money) {
    const p = toPaiseText(String(f[k]));
    if (p === "bad") return `${label}: enter an amount in rupees`;
    out[api] = p;
  }
  const whole = (s: string, label: string, max?: number) => {
    const n = Number(s.trim());
    if (!s.trim() || !Number.isInteger(n) || n < 0 || (max !== undefined && n > max)) return `${label} must be a whole number${max !== undefined ? ` up to ${max}` : ""}`;
    return n;
  };
  for (const [k, api, label, max] of [
    ["aiCredits", "aiCredits", "AI credits included", undefined],
    ["trialDays", "trialDays", "Trial days", 90],
    ["sortOrder", "sortOrder", "Sort order", undefined],
  ] as const) {
    const n = whole(f[k], label, max);
    if (typeof n === "string") return n;
    out[api] = n;
  }
  const limits: Record<string, number> = {};
  for (const [k, label] of [
    ["staff", "Staff limit"],
    ["retailers", "Shops limit"],
  ] as const) {
    if (!f[k].trim()) continue;
    const n = whole(f[k], label);
    if (typeof n === "string") return n;
    limits[k] = n;
  }
  out.limits = limits;
  return out;
}

export default function PlansPage() {
  const owner = useIsOwner();
  const { data, error, reload } = useFetch<Data>("/api/platform/plans");
  const [editing, setEditing] = useState<{ form: Form; creating: boolean } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <div className="space-y-5 pb-16 max-w-4xl">
      <div className="page-head">
        <div>
          <p className="page-kick">Platform</p>
          <h1 className="page-title">Plans</h1>
          <p className="page-sub">Prices are per month. A price change applies from the next invoice of every business on the plan.</p>
        </div>
        {owner && data && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({ form: blank(data.plans.length), creating: true })}>
            <Icon name="plus" className="h-4 w-4" /> New plan
          </button>
        )}
      </div>
      <Flash text={flash} />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <div className="grid gap-4 sm:grid-cols-2">
          {data.plans.map((p) => (
            <div key={p.code} className={`card p-4 space-y-3 min-w-0 ${p.active ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-heading font-bold text-lg">{p.name}</p>
                  <p className="text-xs font-mono text-[var(--muted)]">
                    {p.code} · order {p.sortOrder} · {num(p._count.subscriptions)} on it
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {!p.active && <StatusChip value="x" label="Inactive" />}
                  <StatusChip value="x" label={p.public ? "On sign-up" : "Hidden"} tone={p.public ? "mint" : undefined} />
                </div>
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-[var(--muted)]">Monthly fee</dt>
                <dd className="text-right tabular-nums font-semibold">{inr(p.basePaise)}</dd>
                <dt className="text-[var(--muted)]">Per staff login</dt>
                <dd className="text-right tabular-nums">{inr(p.seatPaise)}</dd>
                <dt className="text-[var(--muted)]">Per active shop</dt>
                <dd className="text-right tabular-nums">{inr(p.retailerPaise)}</dd>
                <dt className="text-[var(--muted)]">AI credits</dt>
                <dd className="text-right tabular-nums">
                  {num(p.aiCredits)} free, then {inr(p.aiCreditPaise)}
                </dd>
                <dt className="text-[var(--muted)]">Limits</dt>
                <dd className="text-right tabular-nums">
                  {p.limits?.staff !== undefined ? num(p.limits.staff) : "∞"} staff · {p.limits?.retailers !== undefined ? num(p.limits.retailers) : "∞"} shops
                </dd>
                <dt className="text-[var(--muted)]">Trial</dt>
                <dd className="text-right">{p.trialDays} days</dd>
              </dl>
              <div className="flex flex-wrap gap-1">
                {p.features.length ? (
                  p.features.map((f) => (
                    <span key={f} className="chip !py-0.5 !px-2 !text-[11px] font-mono" title={data.features[f]}>
                      {f}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[var(--muted)]">Core only</span>
                )}
              </div>
              {owner && (
                <button type="button" className="btn btn-quiet btn-xs" onClick={() => setEditing({ form: toForm(p), creating: false })}>
                  <Icon name="edit" className="h-3.5 w-3.5" /> Edit
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && data && (
        <PlanSheet
          initial={editing.form}
          creating={editing.creating}
          features={data.features}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null);
            setFlash(msg);
            setTimeout(() => setFlash(null), 5000);
            reload();
          }}
        />
      )}
    </div>
  );
}

function PlanSheet({
  initial,
  creating,
  features,
  onClose,
  onSaved,
}: {
  initial: Form;
  creating: boolean;
  features: Record<string, string>;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    const body = toBody(f, creating);
    if (typeof body === "string") {
      setError(body);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (creating) await send("/api/platform/plans", "POST", body);
      else await send(`/api/platform/plans/${encodeURIComponent(f.code)}`, "PATCH", body);
      onSaved(creating ? `Plan ${body.code} made` : `Plan ${f.code} saved`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const money = (k: "base" | "seat" | "retailer" | "aiCredit", label: string) => (
    <Field label={label}>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">₹</span>
        <input className="input !pl-7" inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value)} />
      </div>
    </Field>
  );

  return (
    <Sheet
      title={creating ? "New plan" : `Edit ${initial.name}`}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          <ErrLine text={error} />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : creating ? "Make plan" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" hint={creating ? "2–20 small letters, digits or dashes. Cannot be changed later." : "Cannot be changed."}>
          <input className="input font-mono" value={f.code} disabled={!creating} onChange={(e) => set("code", e.target.value.toLowerCase())} maxLength={20} />
        </Field>
        <Field label="Name">
          <input className="input" value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={40} />
        </Field>
      </div>

      <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide pt-1">Prices per month (₹, before GST)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {money("base", "Monthly fee")}
        {money("seat", "Per staff login")}
        {money("retailer", "Per active shop")}
        {money("aiCredit", "Per AI credit over the free ones")}
        <Field label="AI credits included">
          <input className="input" type="number" min={0} step={1} value={f.aiCredits} onChange={(e) => set("aiCredits", e.target.value)} />
        </Field>
      </div>

      <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide pt-1">Limits (blank = no limit)</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Staff logins">
          <input className="input" type="number" min={0} step={1} value={f.staff} placeholder="No limit" onChange={(e) => set("staff", e.target.value)} />
        </Field>
        <Field label="Shops">
          <input className="input" type="number" min={0} step={1} value={f.retailers} placeholder="No limit" onChange={(e) => set("retailers", e.target.value)} />
        </Field>
      </div>

      <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide pt-1">Modules</p>
      <div className="grid gap-2">
        {Object.entries(features).map(([k, label]) => (
          <label key={k} className="flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-white p-3 cursor-pointer min-w-0">
            <input
              type="checkbox"
              className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mor)]"
              checked={f.features.includes(k)}
              onChange={(e) => set("features", e.target.checked ? [...f.features, k] : f.features.filter((x) => x !== k))}
            />
            <span className="min-w-0">
              <span className="block text-sm font-semibold font-mono">{k}</span>
              <span className="block text-xs text-[var(--muted)]">{label}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Trial days" hint="0 to 90">
          <input className="input" type="number" min={0} max={90} step={1} value={f.trialDays} onChange={(e) => set("trialDays", e.target.value)} />
        </Field>
        <Field label="Sort order" hint="Lower shows first">
          <input className="input" type="number" min={0} step={1} value={f.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
        </Field>
      </div>
      <Toggle checked={f.public} onChange={(v) => set("public", v)} label="Show on the sign-up page" />
      <Toggle checked={f.active} onChange={(v) => set("active", v)} label="Active" hint="Inactive plans are not offered to businesses." />
    </Sheet>
  );
}
