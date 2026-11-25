"use client";

import { useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import TwoStepPanel from "@/components/auth/TwoStepPanel";
import GoogleButton from "@/components/auth/GoogleButton";

export type SecurityStatus = { required: boolean; enabled: boolean; recoveryLeft: number; googleEmail: string | null; googleAvailable: boolean };

async function post(endpoint: string, body: Record<string, unknown>) {
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as { recoveryCodes?: string[] };
}

/**
 * Two-step sign-in and Google for the signed-in person. Shared by business
 * users (/account/security) and the console (/platform/security): the
 * endpoints differ, the screens don't.
 */
export default function SecurityPanel({
  status,
  endpoint,
  googleStart,
  homeHref,
  notice,
  selfHref,
}: {
  status: SecurityStatus;
  endpoint: string;
  googleStart: string;
  homeHref: string;
  notice: string | null;
  /** This page, to come back to after a set-up. */
  selfHref: string;
}) {
  const { t } = useLanguage();
  const [flow, setFlow] = useState<null | "setup" | "newPhone" | "renew" | "disable">(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPhoneCode, setNewPhoneCode] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  async function confirmWithCode(e: React.FormEvent) {
    e.preventDefault();
    if (!flow) return;
    if (flow === "newPhone") {
      setNewPhoneCode(code);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await post(endpoint, { action: flow, code });
      if (data.recoveryCodes) setCodes(data.recoveryCodes);
      else window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    try {
      await post(endpoint, { action: "unlinkGoogle" });
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  const reset = () => {
    setFlow(null);
    setCode("");
    setError(null);
    setNewPhoneCode(null);
  };

  return (
    <div className="space-y-4">
      <Link href={homeHref} className="text-sm font-semibold text-[var(--accent-text)] hover:underline">
        ← {t("sec.back")}
      </Link>
      <h1 className="page-title">{t("sec.title")}</h1>
      {notice && <p role="status" className="text-sm rounded-lg bg-ink/5 text-[var(--ink-2)] px-3 py-2 break-words">{notice}</p>}

      <section className="card p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-heading font-bold">{t("mfa.kick")}</h2>
          <span className={`text-xs font-bold rounded-full px-2.5 py-1 ${status.enabled ? "bg-[var(--scheme-tint)] text-[var(--scheme-text)]" : "bg-ink/5 text-[var(--muted)]"}`}>
            {status.enabled ? t("sec.on") : t("sec.off")}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)]">{status.required ? t("sec.required") : t("sec.optional")}</p>
        {status.enabled && (
          <p className="text-sm">
            {t("sec.recoveryLeft")}: <span className="font-semibold">{status.recoveryLeft}</span>
          </p>
        )}

        {codes ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold">{t("mfa.savedTitle")}</p>
            <p className="text-sm text-[var(--ink-2)]">{t("mfa.savedSub")}</p>
            <ul className="grid grid-cols-2 gap-2 font-mono text-sm rounded-xl bg-ink/5 p-3">
              {codes.map((c) => (
                <li key={c} className="text-center tracking-wider">
                  {c}
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-kesar w-full" onClick={() => window.location.reload()}>
              {t("sec.done")}
            </button>
          </div>
        ) : flow === "setup" || (flow === "newPhone" && newPhoneCode) ? (
          <div className="space-y-3">
            <TwoStepPanel
              endpoint={endpoint}
              mode="setup"
              restartHref={homeHref}
              doneHref={selfHref}
              setupBody={flow === "newPhone" ? { action: "newPhone", code: newPhoneCode } : { action: "setup" }}
            />
            <button type="button" className="text-sm text-[var(--muted)] hover:underline" onClick={reset}>
              {t("sec.cancel")}
            </button>
          </div>
        ) : flow ? (
          <form onSubmit={confirmWithCode} className="space-y-3">
            <label className="block">
              <span className="block text-sm font-semibold mb-1.5">{t("sec.confirmCode")}</span>
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
            {error && <p role="alert" className="text-sm text-[var(--risk-text)]">{error}</p>}
            <div className="flex gap-2">
              <button type="button" className="btn btn-outline flex-1" onClick={reset}>
                {t("sec.cancel")}
              </button>
              <button type="submit" className="btn btn-kesar flex-1" disabled={busy || code.length !== 6}>
                {busy ? t("login.wait") : t("mfa.verify")}
              </button>
            </div>
          </form>
        ) : status.enabled ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setFlow("newPhone")}>
              {t("sec.newPhone")}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setFlow("renew")}>
              {t("sec.newCodes")}
            </button>
            {!status.required && (
              <button type="button" className="btn btn-quiet btn-sm text-[var(--risk-text)]" onClick={() => setFlow("disable")}>
                {t("sec.turnOff")}
              </button>
            )}
          </div>
        ) : (
          <button type="button" className="btn btn-kesar" onClick={() => setFlow("setup")}>
            {t("sec.turnOn")}
          </button>
        )}
      </section>

      {(status.googleAvailable || status.googleEmail) && (
        <section className="card p-5 space-y-3">
          <h2 className="font-heading font-bold">{t("sec.google")}</h2>
          <p className="text-sm text-[var(--muted)] break-all">{status.googleEmail ?? t("sec.googleNone")}</p>
          {status.googleEmail ? (
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={unlink}>
              {t("sec.disconnect")}
            </button>
          ) : (
            <GoogleButton href={`${googleStart}?intent=link`} label={t("sec.connect")} />
          )}
          {error && !flow && <p role="alert" className="text-sm text-[var(--risk-text)]">{error}</p>}
        </section>
      )}
    </div>
  );
}
