"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { InvoiceRow, PlanOption, type Module, type PlanCard, type PlatformInvoice } from "@/components/saas/BillingParts";
import { Bar, ErrorLine, SMALL_CHIP, daysUntil, getJson, inr, istDate, jsonInit, plural } from "@/components/saas/SaasKit";

type SubStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";

type Line = { code: string; description: string; sac: string; qty: number; ratePaise: number; amountPaise: number };

type Data = {
  subscription: {
    status: SubStatus;
    planCode: string;
    planName: string;
    nextPlanCode: string | null;
    trialEndsAt: string | null;
    periodStart: string;
    periodEnd: string;
  } | null;
  tenantStatus: "TRIAL" | "ACTIVE" | "SUSPENDED" | "CLOSED";
  pausedReason: string | null;
  modules: Module[];
  limits: { staff: { limit: number | null; used: number }; retailers: { limit: number | null; used: number } };
  estimate: {
    lines: Line[];
    taxable: number;
    interState: boolean;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
    usage: { seats: number; retailers: number; aiCredits: number };
  } | null;
  gstRegistered: boolean;
  invoices: PlatformInvoice[];
  plans: PlanCard[];
};

const STATUS: Record<SubStatus, { label: string; chip: string }> = {
  TRIAL: { label: "Free trial", chip: "chip-genda" },
  ACTIVE: { label: "Active", chip: "chip-mint" },
  PAST_DUE: { label: "Bill overdue", chip: "chip-kesar" },
  SUSPENDED: { label: "Paused", chip: "chip-kesar" },
  CANCELLED: { label: "Cancelled", chip: "" },
};

function pausedWhy(reason: string | null) {
  if (reason === "billing:trial-ended") return "Your free trial ended without a plan. Pick a plan below and the app switches back on at once.";
  if (reason?.startsWith("billing:")) return "A bill was not paid in time. Pay the unpaid bills below and the app switches back on at once.";
  if (reason) return `Paused by our team: ${reason}. Contact support if you have questions.`;
  return "Contact support to find out why, or pay any unpaid bills below.";
}

export default function BillingPage() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    const r = await getJson<Data>("/api/admin/billing");
    setLoadError(r.ok ? null : r.error);
    if (r.ok) setData(r.data);
  }

  useEffect(() => {
    load();
  }, []);

  if (loadError)
    return (
      <div className="max-w-2xl space-y-3">
        <ErrorLine text={loadError} />
        <button type="button" className="btn btn-quiet btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    );
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const sub = data.subscription;
  const inTrial = sub?.status === "TRIAL";
  const nextPlan = sub?.nextPlanCode ? data.plans.find((p) => p.code === sub.nextPlanCode) : null;
  const paidPlan = sub && sub.planCode !== "trial" ? data.plans.find((p) => p.code === sub.planCode) : null;
  const unpaid = data.invoices.filter((i) => i.status === "ISSUED");
  const paused = data.tenantStatus === "SUSPENDED";
  const lapsedTrial = sub && sub.planCode === "trial" && sub.status !== "TRIAL";

  async function choose(code: string) {
    setBusy(true);
    setPickError(null);
    const r = await getJson<{ ok: true; status: SubStatus; planCode: string; nextPlanCode: string | null }>("/api/admin/billing", jsonInit("POST", { planCode: code }));
    setBusy(false);
    if (!r.ok) {
      setPickError(r.error);
      return;
    }
    const name = data?.plans.find((p) => p.code === code)?.name ?? "The plan";
    setPicking(null);
    setFlash(r.data.status === "TRIAL" ? `${name} is picked. It starts when your trial ends.` : `You are now on ${name}.`);
    await load();
    // The shell's banners and locked pages are drawn on the server.
    router.refresh();
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
    router.refresh();
  }

  function planAction(p: PlanCard) {
    const current = !!sub && !inTrial && sub.planCode === p.code;
    const picked = inTrial && sub?.nextPlanCode === p.code;
    if (current) return <p className="text-sm font-semibold text-[var(--mint-text)] flex items-center gap-1.5"><Icon name="check" className="h-4 w-4" /> Your plan</p>;
    if (picking === p.code) {
      return (
        <div className="space-y-2">
          <p className="text-sm text-[var(--ink-2)]">
            {inTrial
              ? `${p.name} starts when your trial ends${sub?.trialEndsAt ? ` on ${istDate(sub.trialEndsAt)}` : ""}. Until then you try its modules for free.`
              : lapsedTrial || !sub
                ? `${p.name} starts today. Your first bill comes at the end of the month.`
                : `Switch to ${p.name} now? The whole of this month is billed on ${p.name}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => choose(p.code)}>
              {busy ? "Saving…" : inTrial ? `Pick ${p.name}` : `Move to ${p.name}`}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setPicking(null)}>
              Back
            </button>
          </div>
          <ErrorLine text={pickError} />
        </div>
      );
    }
    return (
      <button
        type="button"
        className={`btn btn-sm w-full ${picked ? "btn-quiet" : "btn-secondary"}`}
        disabled={busy || picked || sub?.status === "CANCELLED"}
        onClick={() => {
          setPicking(p.code);
          setPickError(null);
          setFlash(null);
        }}
      >
        {picked ? "Picked for after the trial" : inTrial ? "Pick this plan" : "Choose this plan"}
      </button>
    );
  }

  const ai = data.estimate?.usage.aiCredits ?? 0;
  const aiIncluded = paidPlan?.aiCredits ?? null;

  return (
    <div className="space-y-5 max-w-4xl pb-16">
      <div>
        <p className="page-kick">Plan &amp; billing</p>
        <h1 className="page-title">Your plan</h1>
        <p className="page-sub">What you pay for, what you use, and your bills from us.</p>
      </div>

      {paused && (
        <section className="card p-5 space-y-3 !border-[#e8b27a]">
          <div className="flex items-center gap-2">
            <Icon name="lock" className="h-5 w-5 text-[var(--kesar-text)]" />
            <p className="font-heading font-bold">Why the app is paused</p>
          </div>
          <p className="text-sm text-[var(--ink-2)]">{pausedWhy(data.pausedReason)}</p>
          {unpaid.length > 0 && (
            <ul>
              {unpaid.map((inv) => (
                <InvoiceRow key={inv.id} inv={inv} />
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-quiet btn-sm" disabled={refreshing} onClick={refresh}>
            {refreshing ? "Checking…" : "I have paid, check again"}
          </button>
        </section>
      )}

      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-[var(--muted)]">Current plan</p>
            <p className="font-heading text-2xl font-bold">{sub ? (inTrial ? "Free trial" : sub.planName) : "Free trial"}</p>
          </div>
          {sub && <span className={`${SMALL_CHIP} ${STATUS[sub.status].chip}`}>{STATUS[sub.status].label}</span>}
        </div>

        {sub && inTrial && sub.trialEndsAt && (
          <div className="rounded-xl bg-ink/5 px-3 py-2 text-sm space-y-1">
            <p>
              Trial ends on <b>{istDate(sub.trialEndsAt)}</b> ({plural(daysUntil(sub.trialEndsAt), "day")} left).
            </p>
            <p className="text-[var(--ink-2)]">
              {nextPlan
                ? `After the trial: ${nextPlan.name}, from ${inr(nextPlan.basePaise)} a month. You can change it until then.`
                : "No plan picked yet. Pick one below to keep using the app after the trial."}
            </p>
          </div>
        )}
        {sub && !inTrial && sub.planCode !== "trial" && (
          <p className="text-sm text-[var(--ink-2)]">
            This billing month: {istDate(sub.periodStart)} to {istDate(sub.periodEnd)}. The bill comes at the end of it.
          </p>
        )}
        {lapsedTrial && <p className="text-sm text-[var(--ink-2)]">Your trial has ended. Pick a plan below to carry on.</p>}

        <div className="grid sm:grid-cols-2 gap-4">
          <UsageLine label="Staff logins" used={data.limits.staff.used} limit={data.limits.staff.limit} />
          <UsageLine label="Shops with a login" used={data.limits.retailers.used} limit={data.limits.retailers.limit} />
        </div>

        <details className="group">
          <summary className="cursor-pointer text-xs font-bold text-[var(--kesar-text)] list-none">
            <span className="group-open:hidden">What your plan includes</span>
            <span className="hidden group-open:inline">Hide</span>
          </summary>
          <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1 text-sm mt-2">
            {data.modules.map((m) => (
              <li key={m.code} className={`flex items-start gap-2 ${m.on ? "" : "text-[var(--muted)]"}`}>
                <Icon name={m.on ? "check" : "lock"} className={`h-4 w-4 shrink-0 mt-0.5 ${m.on ? "text-[var(--mint-text)]" : ""}`} />
                {m.label}
              </li>
            ))}
          </ul>
        </details>
      </section>

      <section className="card p-5 space-y-3">
        <p className="font-heading font-bold">This month so far</p>
        {data.estimate ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat value={data.estimate.usage.seats} label="Staff logins" />
              <Stat value={data.estimate.usage.retailers} label="Shops that ordered" />
              <Stat value={ai} label={aiIncluded !== null ? `AI credits (${aiIncluded.toLocaleString("en-IN")} included)` : "AI credits"} />
            </div>
            <div className="rounded-xl bg-white border border-[var(--line)] overflow-hidden">
              <table className="w-full text-sm">
                <tbody>
                  {data.estimate.lines.map((l) => (
                    <tr key={l.code} className="border-b border-[var(--line)]">
                      <td className="px-3 py-2">
                        {l.description}
                        {l.qty > 1 && (
                          <span className="block text-xs text-[var(--muted)]">
                            {l.qty.toLocaleString("en-IN")} × {inr(l.ratePaise)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{inr(l.amountPaise)}</td>
                    </tr>
                  ))}
                  {data.estimate.total !== data.estimate.taxable && (
                    <>
                      <tr className="border-b border-[var(--line)] text-[var(--ink-2)]">
                        <td className="px-3 py-2">Before GST</td>
                        <td className="px-3 py-2 text-right tabular-nums">{inr(data.estimate.taxable)}</td>
                      </tr>
                      {data.estimate.interState ? (
                        <tr className="border-b border-[var(--line)] text-[var(--ink-2)]">
                          <td className="px-3 py-2">IGST 18%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{inr(data.estimate.igst)}</td>
                        </tr>
                      ) : (
                        <tr className="border-b border-[var(--line)] text-[var(--ink-2)]">
                          <td className="px-3 py-2">CGST 9% + SGST 9%</td>
                          <td className="px-3 py-2 text-right tabular-nums">{inr(data.estimate.cgst + data.estimate.sgst)}</td>
                        </tr>
                      )}
                    </>
                  )}
                  <tr className="font-bold">
                    <td className="px-3 py-2">Estimated bill</td>
                    <td className="px-3 py-2 text-right tabular-nums">{inr(data.estimate.total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--muted)]">Staff are counted at the end of the month; shops count once they order in the month.</p>
          </>
        ) : (
          <p className="text-sm text-[var(--muted)]">{inTrial ? "Nothing to pay during the free trial." : "No bill to estimate yet. Pick a plan to start."}</p>
        )}
      </section>

      <section className="space-y-3" id="plans">
        <div>
          <p className="font-heading text-lg font-bold">{inTrial ? "Pick a plan for after the trial" : "Plans"}</p>
          {flash && (
            <p className="text-sm text-[var(--mint-text)] flex items-center gap-1.5 mt-1">
              <Icon name="check" className="h-4 w-4" /> {flash}
            </p>
          )}
        </div>
        {data.plans.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No plans are on offer right now. Contact support.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.plans.map((p) => (
              <PlanOption
                key={p.code}
                plan={p}
                modules={data.modules}
                gstRegistered={data.gstRegistered}
                badge={sub && !inTrial && sub.planCode === p.code ? "Current" : inTrial && sub?.nextPlanCode === p.code ? "Picked" : null}
                action={planAction(p)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="card p-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-heading font-bold">Bills from us</p>
          <button type="button" className="btn btn-quiet btn-xs" disabled={refreshing} onClick={refresh}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {data.invoices.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No bills yet.</p>
        ) : (
          <ul>
            {data.invoices.map((inv) => (
              <InvoiceRow key={inv.id} inv={inv} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function UsageLine({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const near = limit !== null && limit > 0 && used / limit >= 0.9;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{label}</span>
        <span className="tabular-nums">
          <b>{used.toLocaleString("en-IN")}</b>
          {limit !== null ? ` of ${limit.toLocaleString("en-IN")}` : " (no limit)"}
        </span>
      </div>
      {limit !== null && <Bar value={used} max={limit} tone={near ? "kesar" : "mor"} />}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl bg-ink/5 px-3 py-2 min-w-0">
      <p className="stat-num !text-2xl tabular-nums">{value.toLocaleString("en-IN")}</p>
      <p className="stat-lbl !mt-1 leading-tight">{label}</p>
    </div>
  );
}
