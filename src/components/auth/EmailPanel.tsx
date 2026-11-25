"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as { devCode?: string; email?: string };
}

/**
 * The signed-in person's own email (Security page): add or change it with a
 * code sent to the new address, or remove it. Only a confirmed address gets
 * email sign-in codes and password-reset links.
 */
export default function EmailPanel({ email }: { email: string | null }) {
  const { t } = useLanguage();
  const [step, setStep] = useState<"idle" | "enter" | "code">("idle");
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const d = await post({ action: "send", email: value });
      setDevCode(d.devCode ?? null);
      setCode("");
      setStep("code");
    });
  };
  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await post({ action: "confirm", code });
      window.location.reload();
    });
  };
  const remove = () =>
    run(async () => {
      await post({ action: "remove" });
      window.location.reload();
    });
  const cancel = () => {
    setStep("idle");
    setError(null);
    setCode("");
  };

  return (
    <section className="card p-5 space-y-3" aria-labelledby="sec-email">
      <div className="flex items-center justify-between gap-3">
        <h2 id="sec-email" className="font-heading font-bold">
          {t("sec.email")}
        </h2>
        {email && <span className="text-xs font-bold rounded-full px-2.5 py-1 bg-[var(--scheme-tint)] text-[var(--scheme-text)]">{t("sec.emailVerified")}</span>}
      </div>
      <p className="text-sm text-[var(--muted)]">{t("sec.emailWhy")}</p>
      {step === "idle" && <p className="text-sm font-semibold break-all">{email ?? t("sec.emailNone")}</p>}

      {step === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`btn btn-sm ${email ? "btn-outline" : "btn-kesar"}`} onClick={() => setStep("enter")}>
            {email ? t("sec.emailChange") : t("sec.emailAdd")}
          </button>
          {email && (
            <button type="button" className="btn btn-quiet btn-sm text-[var(--risk-text)]" disabled={busy} onClick={remove}>
              {t("sec.emailRemove")}
            </button>
          )}
        </div>
      ) : step === "enter" ? (
        <form onSubmit={send} className="space-y-3">
          <label className="block">
            <span className="block text-sm font-semibold mb-1.5">{t("login.emailLabel")}</span>
            <input className="input" type="email" autoComplete="email" autoCapitalize="none" required autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline flex-1" onClick={cancel}>
              {t("sec.cancel")}
            </button>
            <button type="submit" className="btn btn-kesar flex-1" disabled={busy || !value.trim()}>
              {busy ? t("login.wait") : t("sec.emailSend")}
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={confirm} className="space-y-3">
          {devCode && (
            <p className="text-xs rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2">
              {t("login.demoEmail")} <span className="font-semibold">{devCode}</span>.
            </p>
          )}
          <label className="block">
            <span className="block text-sm font-semibold mb-1.5 break-all">
              {t("sec.emailCodeSent")} {value.trim()}
            </span>
            <input
              className="input text-center tracking-[0.3em] font-mono text-lg"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="••••••"
            />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline flex-1" onClick={cancel}>
              {t("sec.cancel")}
            </button>
            <button type="submit" className="btn btn-kesar flex-1" disabled={busy || code.length !== 6}>
              {busy ? t("login.wait") : t("sec.emailConfirm")}
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-[var(--risk-text)]">{error}</p>}
    </section>
  );
}
