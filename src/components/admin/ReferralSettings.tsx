"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import type { ReferralSettings as ReferralRules } from "@/lib/engage-settings";
import { Field, Toggle, readRupees, rupeeText } from "@/components/admin/AdminKit";

type Form = {
  on: boolean;
  referrerReward: string;
  refereeReward: string;
  minOrder: string;
  validDays: string;
  monthlyCap: string;
};

const toForm = (s: ReferralRules): Form => ({
  on: s.on,
  referrerReward: rupeeText(s.referrerReward),
  refereeReward: rupeeText(s.refereeReward),
  minOrder: rupeeText(s.minOrder),
  validDays: String(s.validDays),
  monthlyCap: String(s.monthlyCap),
});

const TEXT_KEYS = ["referrerReward", "refereeReward", "minOrder", "validDays", "monthlyCap"] as const;

const trimmed = (f: Form): Form => ({ ...f, ...Object.fromEntries(TEXT_KEYS.map((k) => [k, f[k].trim()])) });

/** Rupees (blank = ₹0) → paise up to max, or an error message. */
function paiseIn(s: string, maxPaise: number, what: string): number | string {
  const p = readRupees(s);
  if (p === "bad") return `${what} must be an amount in rupees`;
  const v = p ?? 0;
  if (v > maxPaise) return `${what} can be at most ${formatINR(maxPaise, { whole: true })}`;
  return v;
}

/** Whole number between min and max, or an error message. */
function wholeIn(s: string, min: number, max: number, what: string): number | string {
  const t = s.trim();
  const n = Number(t);
  if (!t || !Number.isInteger(n) || n < min || n > max) return `${what} must be a whole number from ${min} to ${max}`;
  return n;
}

/** Only the changed fields as the API's `referral` patch, or an error message. */
function toPatch(f: Form, was: Form): Partial<ReferralRules> | string {
  const out: Partial<ReferralRules> = {};
  const t = trimmed(f);
  if (t.on !== was.on) out.on = t.on;
  const money = [
    ["referrerReward", 10_000_00, "Reward for the shop that refers"],
    ["refereeReward", 10_000_00, "Reward for the new shop"],
    ["minOrder", 1_000_000_00, "Minimum first order"],
  ] as const;
  for (const [k, max, label] of money) {
    if (t[k] === was[k]) continue;
    const v = paiseIn(t[k], max, label);
    if (typeof v === "string") return v;
    out[k] = v;
  }
  const nums = [
    ["validDays", 7, 365, "Days to get the first order delivered"],
    ["monthlyCap", 1, 100, "Rewards per shop per month"],
  ] as const;
  for (const [k, min, max, label] of nums) {
    if (t[k] === was[k]) continue;
    const v = wholeIn(t[k], min, max, label);
    if (typeof v === "string") return v;
    out[k] = v;
  }
  return out;
}

/** The rule in one plain sentence, from what is typed now. */
function Summary({ f }: { f: Form }) {
  const amt = (s: string) => {
    const p = readRupees(s);
    return p === "bad" ? null : p ?? 0;
  };
  const inr = (p: number) => formatINR(p, { whole: p % 100 === 0 });
  const give = amt(f.referrerReward);
  const get = amt(f.refereeReward);
  const min = amt(f.minOrder);
  const days = Number(f.validDays) || 0;
  const cap = Number(f.monthlyCap) || 0;
  if (give === null || get === null || min === null) return null;
  const rewards = [give > 0 && `${inr(give)} goes into the wallet of the shop that shared its code`, get > 0 && `${inr(get)} into the new shop's wallet`].filter(Boolean);
  return (
    <p className="rounded-xl bg-ink/5 px-3 py-2 text-sm text-[var(--ink-2)]">
      {rewards.length === 0 ? (
        "Both rewards are ₹0, so nobody gets paid. Add a reward above."
      ) : (
        <>
          When a new shop signs up with another shop&apos;s code and its first order{min > 0 ? ` of ${inr(min)} or more` : ""} is delivered within {days}{" "}
          days, {rewards.join(" and ")}. A shop can earn at most {cap} reward{cap === 1 ? "" : "s"} a month.
        </>
      )}
    </p>
  );
}

export default function ReferralSettings({ referral }: { referral: ReferralRules }) {
  const [saved, setSaved] = useState(() => toForm(referral));
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
        body: JSON.stringify({ referral: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      if (data.referral) {
        const next = toForm(data.referral);
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
      <div id="referral" className="pt-4 scroll-mt-20">
        <p className="page-kick">Refer &amp; earn</p>
        <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">Shops bring in new shops</h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          Each shop gets its own code to share. The reward is paid into the shop&apos;s wallet after the new shop&apos;s first order is delivered.
        </p>
      </div>

      <section className="card p-5 space-y-4">
        <Toggle
          checked={f.on}
          onChange={(v) => set("on", v)}
          label="Turn on refer & earn"
          hint="Off: new shops can't sign up with a code. Shops that already joined with one can still earn their reward."
        />
        <div className={`grid gap-4 sm:grid-cols-2 ${f.on ? "" : "opacity-60"}`}>
          <Field label="Reward to the shop that refers (₹)" hint="Up to ₹10,000.">
            <input className="input" inputMode="decimal" placeholder="0" value={f.referrerReward} onChange={(e) => set("referrerReward", e.target.value)} />
          </Field>
          <Field label="Reward to the new shop (₹)" hint="Blank or 0 = no welcome reward.">
            <input className="input" inputMode="decimal" placeholder="0" value={f.refereeReward} onChange={(e) => set("refereeReward", e.target.value)} />
          </Field>
          <Field label="Minimum first order (₹)" hint="Goods value after discounts, before GST. Blank or 0 = any size.">
            <input className="input" inputMode="decimal" placeholder="No minimum" value={f.minOrder} onChange={(e) => set("minOrder", e.target.value)} />
          </Field>
          <Field label="Days to get the first order delivered" hint="Counted from the new shop's sign-up. 7 to 365.">
            <input className="input" inputMode="numeric" value={f.validDays} onChange={(e) => set("validDays", e.target.value.replace(/\D/g, ""))} />
          </Field>
          <Field label="Most paid referrals per shop per month" hint="1 to 100. Past this, the referring shop gets nothing more that month; the new shop still gets its reward.">
            <input className="input" inputMode="numeric" value={f.monthlyCap} onChange={(e) => set("monthlyCap", e.target.value.replace(/\D/g, ""))} />
          </Field>
        </div>
        <Summary f={f} />
        <p className="text-xs text-[var(--muted)] flex items-start gap-1.5">
          <Icon name="gift" className="h-4 w-4 shrink-0" />
          <span>
            Rewards are wallet money the shop can spend on its next orders. A new shop keeps the amounts that were set on the day it signed up, so
            changes here apply to shops that sign up from now on.
          </span>
        </p>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[#a8281e]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">Unsaved refer &amp; earn changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--mint-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">Refer &amp; earn settings saved.</span>
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
              {busy ? "Saving…" : dirty ? "Save refer & earn" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
