"use client";

import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { toPaise } from "@/lib/money";

type Mode = "PREPAID" | "POSTPAID";

type Money = {
  defaultPaymentMode: Mode;
  defaultCreditDays: number;
  defaultCreditLimit: number | null;
  holdOnOverdue: boolean;
  overdueGraceDays: number;
  chequeBouncePenalty: number;
  upiVpa: string;
  upiPayeeName: string;
};

/** Form values as typed (₹ and days as text). */
type Form = {
  defaultPaymentMode: Mode;
  defaultCreditDays: string;
  defaultCreditLimit: string;
  holdOnOverdue: boolean;
  overdueGraceDays: string;
  chequeBouncePenalty: string;
  upiVpa: string;
  upiPayeeName: string;
};

/** Field names in server messages → words the owner knows. */
const FIELD_LABEL: Record<string, string> = {
  defaultCreditDays: "Credit days",
  defaultCreditLimit: "Credit limit",
  overdueGraceDays: "Grace days",
  chequeBouncePenalty: "Cheque bounce charge",
};

const rupees = (p: number) => String(p / 100);

function toForm(m: Money): Form {
  return {
    defaultPaymentMode: m.defaultPaymentMode,
    defaultCreditDays: String(m.defaultCreditDays),
    defaultCreditLimit: m.defaultCreditLimit === null ? "" : rupees(m.defaultCreditLimit),
    holdOnOverdue: m.holdOnOverdue,
    overdueGraceDays: String(m.overdueGraceDays),
    chequeBouncePenalty: rupees(m.chequeBouncePenalty),
    upiVpa: m.upiVpa,
    upiPayeeName: m.upiPayeeName,
  };
}

/** Form → API patch, or an error message. */
function toPatch(f: Form): Money | string {
  const days = (s: string, label: string, max: number) => {
    const n = Number(s);
    if (!s.trim() || !Number.isInteger(n) || n < 0 || n > max) return `${label} must be a whole number from 0 to ${max}`;
    return n;
  };
  const money = (s: string, label: string) => {
    try {
      const p = toPaise(s);
      return p < 0 ? `${label} can't be less than ₹0` : p;
    } catch {
      return `${label} must be an amount in rupees`;
    }
  };
  const creditDays = days(f.defaultCreditDays, "Credit days", 365);
  if (typeof creditDays === "string") return creditDays;
  const grace = days(f.overdueGraceDays, "Grace days", 90);
  if (typeof grace === "string") return grace;
  const limit = f.defaultCreditLimit.trim() ? money(f.defaultCreditLimit, "Credit limit") : null;
  if (typeof limit === "string") return limit;
  const penalty = f.chequeBouncePenalty.trim() ? money(f.chequeBouncePenalty, "Cheque bounce charge") : 0;
  if (typeof penalty === "string") return penalty;
  return {
    defaultPaymentMode: f.defaultPaymentMode,
    defaultCreditDays: creditDays,
    defaultCreditLimit: limit,
    holdOnOverdue: f.holdOnOverdue,
    overdueGraceDays: grace,
    chequeBouncePenalty: penalty,
    upiVpa: f.upiVpa.trim(),
    upiPayeeName: f.upiPayeeName.trim(),
  };
}

function friendly(msg: string) {
  return msg.replace(/^(\w+) must/, (all, key: string) => (FIELD_LABEL[key] ? `${FIELD_LABEL[key]} must` : all));
}

export default function SettingsPage() {
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not load settings");
        const f = toForm(data.money);
        setSaved(f);
        setForm(f);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load settings"));
  }, []);

  if (loadError) return <p className="text-sm text-[#a8281e]">{loadError}</p>;
  if (!form || !saved) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm({ ...form, [k]: v });
    setError(null);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const patch = toPatch(form);
    if (typeof patch === "string") {
      setError(patch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ money: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendly(data.error ?? "Could not save"));
      const f = toForm(data.money);
      setSaved(f);
      setForm(f);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5 max-w-2xl pb-24">
      <div>
        <p className="page-kick">Settings</p>
        <h1 className="page-title">Money rules</h1>
        <p className="page-sub">Defaults for new retailers and how payments work. You can change terms for one retailer from their khata.</p>
      </div>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">New retailers</p>
        <div>
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Default payment mode</span>
          <div className="flex rounded-2xl p-1 bg-ink/5 max-w-md" role="radiogroup">
            {(
              [
                ["POSTPAID", "Postpaid", "Pays after delivery"],
                ["PREPAID", "Prepaid", "Pays first, from wallet"],
              ] as const
            ).map(([v, label, hint]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={form.defaultPaymentMode === v}
                onClick={() => set("defaultPaymentMode", v)}
                className={`flex-1 rounded-xl py-2 px-2 text-sm font-bold transition ${
                  form.defaultPaymentMode === v ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-[var(--ink-2)]"
                }`}
              >
                {label}
                <span className={`block text-[11px] font-normal ${form.defaultPaymentMode === v ? "text-white/75" : "text-[var(--muted)]"}`}>
                  {hint}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Credit days</span>
            <input
              className="input"
              inputMode="numeric"
              value={form.defaultCreditDays}
              onChange={(e) => set("defaultCreditDays", e.target.value)}
            />
            <span className="block text-xs text-[var(--muted)] mt-1">Days after delivery before a bill is overdue.</span>
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Credit limit (₹)</span>
            <input
              className="input"
              inputMode="decimal"
              placeholder="No limit"
              value={form.defaultCreditLimit}
              onChange={(e) => set("defaultCreditLimit", e.target.value)}
            />
            <span className="block text-xs text-[var(--muted)] mt-1">Leave blank for no limit. Orders above it wait for your approval.</span>
          </label>
        </div>
      </section>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Overdue bills</p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={form.holdOnOverdue}
            onChange={(e) => set("holdOnOverdue", e.target.checked)}
          />
          <span
            aria-hidden="true"
            className={`mt-0.5 shrink-0 h-6 w-11 rounded-full p-0.5 transition peer-focus-visible:ring-2 peer-focus-visible:ring-mor ${
              form.holdOnOverdue ? "bg-mor" : "bg-ink/15"
            }`}
          >
            <span className={`block h-5 w-5 rounded-full bg-white shadow transition ${form.holdOnOverdue ? "translate-x-5" : ""}`} />
          </span>
          <span>
            <span className="block text-sm font-medium">Hold orders when bills are overdue</span>
            <span className="block text-xs text-[var(--muted)]">
              A new order from a retailer with an overdue bill waits until you approve it on the Orders screen.
            </span>
          </span>
        </label>
        <label className={`block max-w-xs ${form.holdOnOverdue ? "" : "opacity-50"}`}>
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Grace days</span>
          <input
            className="input"
            inputMode="numeric"
            disabled={!form.holdOnOverdue}
            value={form.overdueGraceDays}
            onChange={(e) => set("overdueGraceDays", e.target.value)}
          />
          <span className="block text-xs text-[var(--muted)] mt-1">Extra days after the due date before the hold starts.</span>
        </label>
      </section>

      <section className="card p-5 space-y-4">
        <p className="font-heading font-bold">Cheques</p>
        <label className="block max-w-xs">
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Cheque bounce charge (₹)</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0"
            value={form.chequeBouncePenalty}
            onChange={(e) => set("chequeBouncePenalty", e.target.value)}
          />
          <span className="block text-xs text-[var(--muted)] mt-1">Added to the retailer&apos;s bill when a cheque bounces. 0 means no charge.</span>
        </label>
      </section>

      <section className="card p-5 space-y-4">
        <div>
          <p className="font-heading font-bold flex items-center gap-2">
            <Icon name="qr" className="h-5 w-5" /> UPI for &ldquo;Pay now&rdquo;
          </p>
          <p className="text-sm text-[var(--muted)] mt-1">
            Retailers see a &ldquo;Pay now&rdquo; QR code for this UPI ID with the amount filled in. After paying they send the UTR,
            and it shows under Payments &rarr; To verify. Leave blank to hide &ldquo;Pay now&rdquo;.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">UPI ID</span>
            <input
              className="input"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="agency@okaxis"
              value={form.upiVpa}
              onChange={(e) => set("upiVpa", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Payee name</span>
            <input
              className="input"
              maxLength={60}
              placeholder="Name on the bank account"
              value={form.upiPayeeName}
              onChange={(e) => set("upiPayeeName", e.target.value)}
            />
          </label>
        </div>
      </section>

      <div className="sticky bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            {error ? (
              <span className="text-[#a8281e]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">You have unsaved changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--mint-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">All changes saved.</span>
            )}
          </p>
          <div className="flex gap-2">
            {dirty && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => setForm(saved)}>
                Undo
              </button>
            )}
            <button type="submit" className="btn btn-kesar btn-sm" disabled={!dirty || busy}>
              {busy ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
