"use client";

import { useState } from "react";
import { Field, Flash, errText, send, useFetch } from "@/components/admin/AdminKit";
import { ConfirmButton, ErrLine, Section, useIsOwner, when } from "./kit";
import type { PlanRow, TenantData } from "./tenant-types";

/** Plan, trial and pause / un-pause. */
export default function TenantPlanPanel({ data, onChanged }: { data: TenantData; onChanged: () => void }) {
  const owner = useIsOwner();
  const { tenant: t, subscription: sub } = data;
  const plans = useFetch<{ plans: PlanRow[] }>(owner ? "/api/platform/plans" : null);
  const [plan, setPlan] = useState("");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const trialish = !!sub && (sub.status === "TRIAL" || (sub.planCode === "trial" && (sub.status === "PAST_DUE" || sub.status === "SUSPENDED")));

  async function patch(key: string, body: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      const r = await send<{ done: string[] }>(`/api/platform/tenants/${t.id}`, "PATCH", body);
      setFlash(`Done: ${r.done.join(", ")}`);
      setReason("");
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Plan and status" sub={sub ? `${sub.plan.name} (${sub.planCode}) · period ${when(sub.periodStart)} to ${when(sub.periodEnd)}` : "No subscription yet"}>
      <Flash text={flash} />

      {owner && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (plan) patch("plan", { planCode: plan });
          }}
        >
          <Field label="Move to plan" className="flex-1 min-w-[180px]" hint={sub?.status === "TRIAL" ? "During the trial this sets the plan that starts when the trial ends." : "Starts now."}>
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)} disabled={!plans.data}>
              <option value="">{plans.data ? "Pick a plan" : plans.error ? "Plans did not load" : "Loading…"}</option>
              {plans.data?.plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} ({p.code}){p.active ? "" : " · inactive"}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!plan || !!busy}>
            {busy === "plan" ? "Saving…" : "Change plan"}
          </button>
        </form>
      )}
      {plans.error && <ErrLine text={plans.error} />}

      {trialish && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            patch("trial", { extendTrialDays: Number(days) });
          }}
        >
          <Field label="Extend trial by (days)" hint={sub?.trialEndsAt ? `Trial ends ${when(sub.trialEndsAt, true)}` : undefined}>
            <input className="input !w-28" type="number" min={1} max={60} step={1} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <button type="submit" className="btn btn-quiet btn-sm" disabled={!!busy || !(Number(days) >= 1 && Number(days) <= 60)}>
            {busy === "trial" ? "Saving…" : "Extend trial"}
          </button>
        </form>
      )}

      {t.status === "SUSPENDED" ? (
        <div className="rounded-2xl bg-[var(--risk-tint)]/60 p-3 space-y-2">
          <p className="text-sm">
            <span className="font-semibold text-[var(--risk-text)]">Paused</span> {t.suspendedAt && `since ${when(t.suspendedAt, true)}`}
            {t.suspendReason && <span className="block text-[var(--ink-2)]">{t.suspendReason}</span>}
          </p>
          <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => patch("reactivate", { reactivate: true })}>
            {busy === "reactivate" ? "Working…" : "Reactivate"}
          </button>
        </div>
      ) : (
        t.status !== "CLOSED" && (
          <div className="space-y-2">
            <Field label="Pause this business" hint="Everyone in the business is locked out until you reactivate it.">
              <input className="input" placeholder="Why (shown to the business)" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <ConfirmButton
              label="Pause business"
              question={`Pause ${t.name}?`}
              yes="Yes, pause"
              busy={busy === "suspend"}
              disabled={!reason.trim() || !!busy}
              onConfirm={() => patch("suspend", { suspend: { reason: reason.trim() } })}
            />
          </div>
        )
      )}

      <ErrLine text={error} />
    </Section>
  );
}
