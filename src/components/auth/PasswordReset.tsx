"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import { BrandLockup } from "@/components/BrandMark";

/**
 * "Forgot password?" and "Choose a new password", for business logins
 * (/login/forgot, /login/reset) and the console (/platform/login/…). Only
 * the endpoints, the field and the minimum length differ.
 */

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as { redirect?: string };
}

function Shell({ appName, logoUrl, kick, title, sub, children }: { appName?: string; logoUrl: string | null; kick: string; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between gap-3 mb-8">
          <Link href="/" aria-label={appName ?? "Home"} className="min-w-0">
            <BrandLockup name={appName} logoUrl={logoUrl} large />
          </Link>
          <LanguageToggle />
        </div>
        <div className="card card-deco p-6 sm:p-7">
          <p className="page-kick">{kick}</p>
          <h1 className="page-title">{title}</h1>
          {sub && <p className="page-sub mb-6">{sub}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function ForgotPassword({
  appName,
  logoUrl = null,
  endpoint,
  backHref,
  field,
}: {
  appName?: string;
  logoUrl?: string | null;
  endpoint: string;
  backHref: string;
  /** "login": login id or email (business); "email": the console. */
  field: "login" | "email";
}) {
  const { t } = useLanguage();
  const [value, setValue] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(endpoint, field === "login" ? { login: value } : { email: value });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell appName={appName} logoUrl={logoUrl} kick={t("login.forgot")} title={t("reset.title")} sub={sent ? undefined : t("reset.sub")}>
      {sent ? (
        <div className="space-y-4">
          <p role="status" className="text-sm rounded-lg bg-[var(--genda-tint)] text-[var(--genda-text)] px-3 py-2">
            {t("reset.sent")}
          </p>
          {field === "login" && <p className="text-xs text-[var(--muted)]">{t("reset.noEmail")}</p>}
          <Link href={backHref} className="btn btn-outline w-full">
            {t("reset.back")}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-foreground/70 mb-1">{field === "login" ? t("reset.login") : t("login.emailLabel")}</span>
            <input
              className="input"
              type={field === "email" ? "email" : "text"}
              autoCapitalize="none"
              autoComplete={field === "email" ? "email" : "username"}
              required
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
          {error && <p role="alert" className="text-sm text-[#a8281e]">{error}</p>}
          <button type="submit" className="btn btn-kesar w-full" disabled={busy || !value.trim()}>
            {busy ? t("login.wait") : t("reset.send")}
          </button>
          {field === "login" && <p className="text-xs text-[var(--muted)]">{t("reset.noEmail")}</p>}
          <p className="text-center">
            <Link href={backHref} className="text-sm text-[var(--ink-2)] hover:underline inline-block min-h-[44px] leading-[44px]">
              {t("reset.back")}
            </Link>
          </p>
        </form>
      )}
    </Shell>
  );
}

export function NewPassword({
  appName,
  logoUrl = null,
  endpoint,
  token,
  min,
  forgotHref,
  backHref,
}: {
  appName?: string;
  logoUrl?: string | null;
  endpoint: string;
  token: string;
  min: number;
  forgotHref: string;
  backHref: string;
}) {
  const { t } = useLanguage();
  const [state, setState] = useState<"checking" | "ok" | "bad">(token ? "checking" : "bad");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    fetch(`${endpoint}?t=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => live && setState(d?.ok ? "ok" : "bad"))
      .catch(() => live && setState("ok"));
    return () => {
      live = false;
    };
  }, [endpoint, token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== again) {
      setError(t("reset.mismatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await post(endpoint, { token, password });
      window.location.assign(data.redirect ?? backHref);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.error"));
      setBusy(false);
    }
  }

  return (
    <Shell appName={appName} logoUrl={logoUrl} kick={t("reset.title")} title={t("reset.newTitle")} sub={state === "ok" ? t("reset.rules").replace("{n}", String(min)) : undefined}>
      {state === "checking" ? (
        <p className="text-sm text-[var(--muted)]">{t("login.wait")}</p>
      ) : state === "bad" ? (
        <div className="space-y-4">
          <p role="alert" className="text-sm rounded-lg bg-[#a8281e]/10 text-[#a8281e] px-3 py-2">
            {t("reset.bad")}
          </p>
          <Link href={forgotHref} className="btn btn-kesar w-full">
            {t("reset.again2")}
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-foreground/70 mb-1">{t("reset.new")}</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={min} autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="block">
            <span className="block text-sm font-medium text-foreground/70 mb-1">{t("reset.again")}</span>
            <input className="input" type="password" autoComplete="new-password" required minLength={min} value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-[#a8281e]">{error}</p>}
          <button type="submit" className="btn btn-kesar w-full" disabled={busy || password.length < min || !again}>
            {busy ? t("login.wait") : t("reset.save")}
          </button>
        </form>
      )}
    </Shell>
  );
}
