"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, Field, Toggle, send, errText, useFetch } from "@/components/admin/AdminKit";
import CopyButton, { CopyLine } from "@/components/admin/CopyButton";

type Provider = "none" | "razorpay" | "simulator";

type Gateway = {
  provider: Provider;
  keyId: string;
  mode: "live" | "test" | null;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  acceptPartial: boolean;
  linkDays: number;
  qrMinutes: number;
  retailerPay: boolean;
  webhookUrl: string;
  webhookEvents: string[];
  simulatorAllowed: boolean;
};

type Form = {
  provider: Provider;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  acceptPartial: boolean;
  retailerPay: boolean;
  linkDays: string;
  qrMinutes: string;
};

const toForm = (g: Gateway): Form => ({
  provider: g.provider,
  keyId: g.keyId,
  keySecret: "",
  webhookSecret: "",
  acceptPartial: g.acceptPartial,
  retailerPay: g.retailerPay,
  linkDays: String(g.linkDays),
  qrMinutes: String(g.qrMinutes),
});

const modeOf = (keyId: string) => (keyId.startsWith("rzp_live_") ? "live" : keyId.startsWith("rzp_test_") ? "test" : null);

function wholeIn(s: string, min: number, max: number, what: string): number | string {
  const t = s.trim();
  const n = Number(t);
  if (!t || !Number.isInteger(n) || n < min || n > max) return `${what} must be a whole number from ${min} to ${max}`;
  return n;
}

/** Only what changed, as the gateway PATCH body, or an error message. */
function toPatch(f: Form, g: Gateway): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  const keyId = f.keyId.trim();
  if (f.provider !== g.provider) out.provider = f.provider;
  if (keyId !== g.keyId) out.keyId = keyId;
  if (f.keySecret.trim()) out.keySecret = f.keySecret.trim();
  if (f.webhookSecret.trim()) out.webhookSecret = f.webhookSecret.trim();
  if (f.acceptPartial !== g.acceptPartial) out.acceptPartial = f.acceptPartial;
  if (f.retailerPay !== g.retailerPay) out.retailerPay = f.retailerPay;
  const days = wholeIn(f.linkDays, 1, 90, "Days a link stays open");
  if (typeof days === "string") return days;
  if (days !== g.linkDays) out.linkDays = days;
  const mins = wholeIn(f.qrMinutes, 5, 240, "Minutes a QR stays open");
  if (typeof mins === "string") return mins;
  if (mins !== g.qrMinutes) out.qrMinutes = mins;
  if (f.provider === "razorpay") {
    if (!keyId) return "Enter the Razorpay key id";
    if (keyId !== g.keyId && !out.keySecret) return "A new key id needs its key secret too";
    if (!g.hasKeySecret && !out.keySecret) return "Enter the Razorpay key secret";
  }
  return out;
}

function ModeChip({ mode }: { mode: "live" | "test" | null }) {
  if (!mode) return null;
  return (
    <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${mode === "live" ? "chip-mint" : "chip-genda"}`}>
      {mode === "live" ? "Live: real money" : "Test mode"}
    </span>
  );
}

/** Online payments (Razorpay links and QR codes). Loads its own data: secrets are kept apart from the other settings. */
export default function GatewaySettings() {
  const { data, error, reload } = useFetch<Gateway>("/api/admin/settings/gateway");
  return (
    <div className="space-y-5">
      <div id="online" className="pt-4 scroll-mt-20">
        <p className="page-kick">Online payments</p>
        <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">Payment links and QR codes</h2>
        <p className="text-sm text-[var(--muted)] mt-1">
          Send a shop a link to pay, or show a QR at delivery. Money paid online is matched to the bill and goes into the khata by itself.
        </p>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && <GatewayForm initial={data} />}
    </div>
  );
}

function GatewayForm({ initial }: { initial: Gateway }) {
  const [saved, setSaved] = useState(initial);
  const [f, setF] = useState(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [replaceKey, setReplaceKey] = useState(false);
  const [replaceHook, setReplaceHook] = useState(false);

  const base = toForm(saved);
  const dirty = JSON.stringify({ ...f, keyId: f.keyId.trim(), linkDays: f.linkDays.trim(), qrMinutes: f.qrMinutes.trim() }) !== JSON.stringify(base);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };

  const showSim = saved.simulatorAllowed || saved.provider === "simulator";
  const options = [
    ["none", "Off", "No online payments"],
    ["razorpay", "Razorpay", "Links and QR codes"],
    ...(showSim ? ([["simulator", "Practice gateway", "No real money"]] as const) : []),
  ] as const;
  const mode = f.keyId.trim() === saved.keyId ? saved.mode : modeOf(f.keyId.trim());
  const on = saved.provider === "simulator" || (saved.provider === "razorpay" && !!saved.keyId && saved.hasKeySecret);

  function undo() {
    setF(toForm(saved));
    setReplaceKey(false);
    setReplaceHook(false);
    setError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch = toPatch(f, saved);
    if (typeof patch === "string") return setError(patch);
    if (!Object.keys(patch).length) return undo();
    setBusy(true);
    setError(null);
    try {
      const next = await send<Gateway>("/api/admin/settings/gateway", "PATCH", patch);
      setSaved(next);
      setF(toForm(next));
      setReplaceKey(false);
      setReplaceHook(false);
      setSavedAt(new Date());
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-heading font-bold flex items-center gap-2">
            <Icon name="card" className="h-5 w-5" /> Payment gateway
          </p>
          <span className="flex flex-wrap gap-1.5">
            {saved.provider === "razorpay" && <ModeChip mode={saved.mode} />}
            <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${on ? "chip-mint" : ""}`}>{on ? "On" : "Off"}</span>
          </span>
        </div>
        <div className="flex rounded-2xl p-1 bg-ink/5 max-w-lg" role="radiogroup" aria-label="Payment gateway">
          {options.map(([v, label, hint]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={f.provider === v}
              onClick={() => set("provider", v)}
              className={`flex-1 min-w-0 rounded-xl py-2 px-2 text-sm font-bold transition ${
                f.provider === v ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "text-[var(--ink-2)]"
              }`}
            >
              {label}
              <span className={`block text-[11px] font-normal ${f.provider === v ? "text-white/75" : "text-[var(--muted)]"}`}>{hint}</span>
            </button>
          ))}
        </div>
        {f.provider === "none" && <p className="text-sm text-[var(--muted)]">Shops pay by UPI, cash or cheque as now. No links or QR codes are made.</p>}
        {f.provider === "simulator" && (
          <p className="rounded-xl bg-[var(--scheme-tint)] px-3 py-2 text-sm text-[var(--scheme-text)] flex items-start gap-2">
            <Icon name="alert" className="h-4 w-4 shrink-0 mt-0.5" />
            <span>Practice only. Links and QR codes open a test page with a button that marks them paid. No real money moves.</span>
          </p>
        )}

        {f.provider === "razorpay" && (
          <div className="space-y-4">
            <Field
              label="Key id"
              hint={
                <>
                  From Razorpay Dashboard → Account &amp; Settings → API keys. Starts with rzp_test_ or rzp_live_.{" "}
                  <ModeChip mode={mode} />
                </>
              }
            >
              <input
                className="input font-mono"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="rzp_test_…"
                value={f.keyId}
                onChange={(e) => set("keyId", e.target.value.replace(/\s/g, ""))}
              />
            </Field>
            <SecretField
              label="Key secret"
              hasSaved={saved.hasKeySecret && f.keyId.trim() === saved.keyId}
              replacing={replaceKey}
              onReplace={() => setReplaceKey(true)}
              onCancel={() => {
                setReplaceKey(false);
                set("keySecret", "");
              }}
              value={f.keySecret}
              onChange={(v) => set("keySecret", v)}
              hint="Shown once in Razorpay when you make the key. We store it locked and never show it again."
            />
          </div>
        )}
      </section>

      {f.provider !== "none" && (
        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">What shops can do</p>
          <Toggle
            checked={f.retailerPay}
            onChange={(v) => set("retailerPay", v)}
            label="Shops can pay online"
            hint="Shops can pay their dues online from their khata."
          />
          <Toggle
            checked={f.acceptPartial}
            onChange={(v) => set("acceptPartial", v)}
            label="Allow part payments"
            hint="Shops may pay part of a link. The rest stays due on the same link."
          />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Link stays open (days)" hint="1 to 90.">
              <input className="input" inputMode="numeric" value={f.linkDays} onChange={(e) => set("linkDays", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Delivery QR stays open (minutes)" hint="5 to 240.">
              <input className="input" inputMode="numeric" value={f.qrMinutes} onChange={(e) => set("qrMinutes", e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>
        </section>
      )}

      {f.provider === "razorpay" && (
        <section className="card p-5 space-y-4">
          <div>
            <p className="font-heading font-bold">Razorpay webhook</p>
            <p className="text-sm text-[var(--muted)] mt-1">
              Tells us the moment a shop pays. In Razorpay Dashboard → Webhooks, add this URL, tick these events, and paste the same secret here.
            </p>
          </div>
          <div className="space-y-1">
            <span className="block text-sm font-medium text-[var(--ink-2)]">Webhook URL</span>
            <CopyLine value={saved.webhookUrl} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="block text-sm font-medium text-[var(--ink-2)]">Events to tick</span>
              <CopyButton text={saved.webhookEvents.join("\n")} label="Copy all" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {saved.webhookEvents.map((ev) => (
                <span key={ev} className="chip !py-0.5 !px-2 !text-[11.5px] font-mono">
                  {ev}
                </span>
              ))}
            </div>
          </div>
          <SecretField
            label="Webhook secret"
            hasSaved={saved.hasWebhookSecret}
            replacing={replaceHook}
            onReplace={() => setReplaceHook(true)}
            onCancel={() => {
              setReplaceHook(false);
              set("webhookSecret", "");
            }}
            value={f.webhookSecret}
            onChange={(v) => set("webhookSecret", v)}
            hint="Make up a long secret (8 to 128 characters), type it in Razorpay, and paste the same one here."
          />
          {!saved.hasWebhookSecret && (
            <p className="text-xs text-[var(--scheme-text)] flex items-start gap-1.5">
              <Icon name="alert" className="h-4 w-4 shrink-0" />
              <span>Without the webhook, payments still come in, but up to 10 minutes late.</span>
            </p>
          )}
        </section>
      )}

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[var(--risk-text)]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">Unsaved online payment changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--success-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">Online payment settings saved.</span>
            )}
          </p>
          <div className="flex gap-2">
            {dirty && (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={undo}>
                Undo
              </button>
            )}
            <button type="submit" className="btn btn-kesar btn-sm" disabled={!dirty || busy}>
              {busy ? "Saving…" : dirty ? "Save online payments" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

/** A secret the server never sends back: "Saved" + Replace, or a password box. */
function SecretField({
  label,
  hasSaved,
  replacing,
  onReplace,
  onCancel,
  value,
  onChange,
  hint,
}: {
  label: string;
  hasSaved: boolean;
  replacing: boolean;
  onReplace: () => void;
  onCancel: () => void;
  value: string;
  onChange: (v: string) => void;
  hint: string;
}) {
  if (hasSaved && !replacing) {
    return (
      <div>
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">{label}</span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip chip-mint !py-0.5 !px-2 !text-[11.5px]">
            <Icon name="check" className="h-3.5 w-3.5" /> Saved
          </span>
          <button type="button" className="btn btn-quiet btn-xs" onClick={onReplace}>
            Replace
          </button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <Field label={hasSaved ? `New ${label.toLowerCase()}` : label} hint={hasSaved ? "Leave blank to keep the saved one." : hint}>
        <input
          className="input font-mono"
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      {hasSaved && (
        <button type="button" className="btn btn-quiet btn-xs mt-2" onClick={onCancel}>
          Keep the saved one
        </button>
      )}
    </div>
  );
}
