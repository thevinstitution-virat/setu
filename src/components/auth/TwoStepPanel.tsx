"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Res = { error?: string; redirect?: string; secret?: string; qr?: string; recoveryCodes?: string[]; sent?: boolean; devCode?: string };

async function call(endpoint: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Res }> {
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Res;
  return { ok: res.ok, data };
}

/**
 * The second step of a sign-in (and turning it on from the Security page):
 *   setup  — QR code + key for the authenticator app, first code, recovery codes
 *   verify — code from the app, a recovery code, or (when offered) an SMS code
 * `endpoint` takes { action: setup | confirm | verify | sms }.
 */
export default function TwoStepPanel({
  endpoint,
  mode,
  smsPhone = null,
  restartHref,
  lostNote = false,
  doneHref,
  setupBody = { action: "setup" },
}: {
  endpoint: string;
  mode: "setup" | "verify";
  /** Masked phone when an SMS code may be used instead (business sign-ins only). */
  smsPhone?: string | null;
  restartHref: string;
  lostNote?: boolean;
  /** Where "continue" goes when the server doesn't say (Security page). */
  doneHref?: string;
  /** What asks the server for a new QR code (Security page: a new phone needs the current code first). */
  setupBody?: Record<string, unknown>;
}) {
  const { t } = useLanguage();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [kind, setKind] = useState<"app" | "recovery" | "sms">("app");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  function fail(ok: boolean, data: Res) {
    if (ok) return false;
    setError(data.error ?? t("login.error"));
    if (data.redirect) setExpired(true);
    return true;
  }

  useEffect(() => {
    if (mode !== "setup") return;
    let live = true;
    call(endpoint, setupBody)
      .then(({ ok, data }) => {
        if (!live) return;
        if (ok && data.secret && data.qr) setSetup({ secret: data.secret, qr: data.qr });
        else {
          setError(data.error ?? t("login.error"));
          if (data.redirect) setExpired(true);
        }
      })
      .catch(() => live && setError(t("login.error")));
    return () => {
      live = false;
    };
    // setupBody is read once, when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, mode, t]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = mode === "setup" ? { action: "confirm", code } : kind === "sms" ? { action: "verify", smsCode: code } : { action: "verify", code };
      const { ok, data } = await call(endpoint, body);
      if (fail(ok, data)) return;
      if (data.recoveryCodes) {
        setCodes(data.recoveryCodes);
        setNext(data.redirect ?? doneHref ?? null);
        return;
      }
      window.location.assign(data.redirect ?? doneHref ?? "/");
    } catch {
      setError(t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  async function sendSms() {
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await call(endpoint, { action: "sms" });
      if (fail(ok, data)) return;
      setKind("sms");
      setCode("");
      setDevCode(data.devCode ?? null);
    } catch {
      setError(t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    const text = codes.join("\n");
    return (
      <div className="space-y-4">
        <div>
          <h2 className="font-heading font-bold text-lg">{t("mfa.savedTitle")}</h2>
          <p className="text-sm text-[var(--ink-2)] mt-1">{t("mfa.savedSub")}</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm rounded-xl bg-ink/5 p-3" aria-label={t("mfa.recoveryLabel")}>
          {codes.map((c) => (
            <li key={c} className="text-center tracking-wider">
              {c}
            </li>
          ))}
        </ul>
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="button"
            className="btn btn-outline flex-1"
            onClick={() => {
              navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
            }}
          >
            {copied ? t("mfa.copied") : t("mfa.copy")}
          </button>
          <button type="button" className="btn btn-kesar flex-1" onClick={() => window.location.assign(next ?? "/")}>
            {t("mfa.continue")}
          </button>
        </div>
      </div>
    );
  }

  const label = mode === "setup" || kind === "app" ? t("mfa.code") : kind === "sms" ? t("mfa.smsLabel") : t("mfa.recoveryLabel");
  const numeric = mode === "setup" || kind !== "recovery";

  return (
    <div className="space-y-4">
      {mode === "setup" && (
        <ol className="space-y-3 text-sm text-[var(--ink-2)] list-decimal pl-5">
          <li>{t("mfa.step1")}</li>
          <li>
            {t("mfa.step2")}
            <div className="mt-2 flex flex-col items-center gap-2">
              {setup ? (
                // A data: URL made on the server; next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={setup.qr} alt="QR code" width={200} height={200} className="rounded-lg bg-white p-2 border border-[var(--line)]" />
              ) : (
                <div className="h-[200px] w-[200px] rounded-lg bg-ink/5 animate-pulse" aria-hidden />
              )}
              {setup && (
                <p className="text-xs text-center">
                  {t("mfa.manual")}
                  <span className="block font-mono text-[13px] tracking-wider break-all text-[var(--ink)] mt-1 select-all">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</span>
                </p>
              )}
            </div>
          </li>
          <li>{t("mfa.step3")}</li>
        </ol>
      )}

      {kind === "sms" && smsPhone && (
        <p className="text-sm text-[var(--ink-2)]">
          {t("mfa.smsSent")} <span className="font-semibold">{smsPhone}</span>
          {devCode && <span className="block text-xs text-[var(--muted)] mt-1">Demo code: {devCode}</span>}
        </p>
      )}

      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="block text-sm font-semibold mb-1.5">{label}</span>
          <input
            className="input text-center tracking-[0.3em] font-mono text-lg"
            value={code}
            onChange={(e) => setCode(numeric ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value.slice(0, 12))}
            inputMode={numeric ? "numeric" : "text"}
            autoComplete="one-time-code"
            autoFocus
            required
            placeholder={numeric ? "••••••" : "xxxx-xxxx"}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-[var(--risk-text)]">
            {error}
            {expired && (
              <>
                {" "}
                <a href={restartHref} className="font-bold underline">
                  {t("mfa.startOver")}
                </a>
              </>
            )}
          </p>
        )}
        <button type="submit" className="btn btn-kesar w-full" disabled={busy || (numeric ? code.length !== 6 : code.replace(/[^a-z0-9]/gi, "").length !== 8) || (mode === "setup" && !setup)}>
          {busy ? t("login.wait") : t("mfa.verify")}
        </button>
      </form>

      {mode === "verify" && (
        <div className="flex flex-col items-start gap-2 text-sm">
          {kind !== "recovery" ? (
            <button type="button" className="font-semibold text-[var(--accent-text)] hover:underline" onClick={() => { setKind("recovery"); setCode(""); setError(null); }}>
              {t("mfa.useRecovery")}
            </button>
          ) : (
            <button type="button" className="font-semibold text-[var(--accent-text)] hover:underline" onClick={() => { setKind("app"); setCode(""); setError(null); }}>
              {t("mfa.useApp")}
            </button>
          )}
          {smsPhone && kind !== "sms" && (
            <button type="button" className="font-semibold text-[var(--accent-text)] hover:underline disabled:opacity-50" disabled={busy} onClick={sendSms}>
              {t("mfa.smsSend")}
            </button>
          )}
          {lostNote && <p className="text-xs text-[var(--muted)] mt-1">{t("mfa.lost")}</p>}
        </div>
      )}
    </div>
  );
}
