"use client";

import Icon from "@/components/Icon";

/** One plan as /api/signup/plans gives it (all prices in paise). */
export type SignupPlan = {
  code: string;
  name: string;
  basePaise: number;
  seatPaise: number;
  retailerPaise: number;
  aiCredits: number;
  limits: { staff?: number; retailers?: number };
  features: { code: string; label: string }[];
};

/** "later" = no plan yet: the trial runs and the owner picks one from Billing. */
export type PlanChoice = string | "later" | "";

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const count = (n: number) => n.toLocaleString("en-IN");

export function PlanCards({
  plans,
  trialDays,
  value,
  onChange,
  error,
}: {
  plans: SignupPlan[];
  trialDays: number;
  value: PlanChoice;
  onChange: (v: PlanChoice) => void;
  error?: string | null;
}) {
  return (
    <div className="space-y-3" role="radiogroup" aria-label="Plan" aria-describedby={error ? "f-planCode-err" : undefined} id="f-planCode" tabIndex={-1}>
      {plans.map((p) => {
        const on = value === p.code;
        return (
          <button
            key={p.code}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(p.code)}
            className={`w-full text-left rounded-2xl border-2 p-4 transition bg-white/70 ${
              on ? "border-[var(--kesar)] shadow-[0_10px_24px_-18px_rgba(15,42,42,.7)]" : "border-black/10 hover:border-black/20"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-heading font-bold text-[17px] text-ink">{p.name}</p>
                <p className="text-xs text-[var(--muted)] mt-0.5">After the {trialDays}-day free trial</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-heading font-bold text-[20px] leading-none text-ink">
                  {p.basePaise > 0 ? rupees(p.basePaise) : "Free"}
                </p>
                {p.basePaise > 0 && <p className="text-xs text-[var(--muted)] mt-1">per month</p>}
              </div>
            </div>

            {(p.seatPaise > 0 || p.retailerPaise > 0) && (
              <p className="text-xs text-[var(--ink-2)] mt-2">
                {[
                  p.seatPaise > 0 ? `+ ${rupees(p.seatPaise)} per staff login a month` : null,
                  p.retailerPaise > 0 ? `+ ${rupees(p.retailerPaise)} per active shop a month` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}

            <div className="flex flex-wrap gap-1.5 mt-3">
              {p.limits.staff !== undefined && <span className="chip">Up to {count(p.limits.staff)} staff</span>}
              {p.limits.retailers !== undefined && <span className="chip">Up to {count(p.limits.retailers)} shops</span>}
              {p.aiCredits > 0 && <span className="chip">{count(p.aiCredits)} AI credits a month</span>}
            </div>

            <ul className="mt-3 space-y-1.5">
              <li className="flex gap-2 text-sm text-[var(--ink-2)]">
                <Icon name="check" className="h-4 w-4 mt-0.5 shrink-0 text-[var(--success-text)]" />
                Ordering, delivery and GST invoices
              </li>
              {p.features.map((f) => (
                <li key={f.code} className="flex gap-2 text-sm text-[var(--ink-2)]">
                  <Icon name="check" className="h-4 w-4 mt-0.5 shrink-0 text-[var(--success-text)]" />
                  {f.label}
                </li>
              ))}
            </ul>
            {on && <span className="sr-only">Selected</span>}
          </button>
        );
      })}

      <button
        type="button"
        role="radio"
        aria-checked={value === "later"}
        onClick={() => onChange("later")}
        className={`w-full text-left rounded-2xl border-2 border-dashed p-4 transition ${
          value === "later" ? "border-[var(--kesar)] bg-white/70" : "border-black/15 hover:border-black/25"
        }`}
      >
        <p className="font-bold text-ink">Not sure yet</p>
        <p className="text-sm text-[var(--ink-2)] mt-0.5">
          Try it first and pick a plan from Billing before the {trialDays} days are up.
        </p>
      </button>

      {error && (
        <p id="f-planCode-err" role="alert" className="text-xs font-semibold text-[var(--risk-text)]">
          {error}
        </p>
      )}
    </div>
  );
}
