"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import OtpInput from "@/components/ui/OtpInput";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const COPY = {
  en: {
    label: "Email address",
    send: "Email me a code",
    wait: "Please wait…",
    sent: "We emailed a 6-digit code. It works for 10 minutes, once. Check spam too.",
    sentDev: "Demo mode: your code is",
    code: "Enter the code",
    verify: "Sign in",
    other: "Use another address",
    resend: "Send a new code",
    hint: "No password. We email you a one-time code.",
    bad: "Enter a valid email address",
    wrong: "That code is wrong or has expired",
    pick: "Where do you want to sign in?",
  },
  hi: {
    label: "ईमेल पता",
    send: "मुझे कोड ईमेल करें",
    wait: "कृपया रुकें…",
    sent: "हमने 6 अंकों का कोड ईमेल किया है। यह 10 मिनट तक, एक बार चलता है। स्पैम भी देखें।",
    sentDev: "डेमो मोड: आपका कोड",
    code: "कोड लिखें",
    verify: "साइन इन करें",
    other: "दूसरा पता इस्तेमाल करें",
    resend: "नया कोड भेजें",
    hint: "कोई पासवर्ड नहीं। हम आपको एक बार चलने वाला कोड ईमेल करते हैं।",
    bad: "सही ईमेल पता लिखें",
    wrong: "कोड गलत है या पुराना हो गया है",
    pick: "आप कहाँ साइन इन करना चाहते हैं?",
  },
};

type Place = { label: string; url: string };

/**
 * The one sign-in form, for business addresses, the main address and the console: type an email
 * address, get a one-time code, type the code. Never a link in an email. On the main address a
 * correct code hands the browser on to the place it belongs to (or lets the person pick one).
 */
export default function EmailCodeForm({ hint }: { hint?: string }) {
  const router = useRouter();
  const { lang } = useLanguage();
  const c = COPY[lang];
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post<T>(url: string, body: unknown, fallback: string): Promise<T> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? fallback);
    return data as T;
  }

  async function send() {
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError(c.bad);
    setBusy(true);
    try {
      const d = await post<{ devCode?: string }>("/api/auth/email-code/request", { email }, c.bad);
      setDevCode(d.devCode ?? null);
      setCode("");
      setStep("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : c.bad);
    } finally {
      setBusy(false);
    }
  }

  async function verify(value = code) {
    setError(null);
    setBusy(true);
    try {
      const d = await post<{ redirect?: string; choose?: Place[] }>("/api/auth/email-code/verify", { email, code: value }, c.wrong);
      if (d.choose) {
        setPlaces(d.choose);
        setBusy(false);
      } else if (d.redirect) {
        // Same address: client navigation. Another address (main address → a business): a full page load.
        if (d.redirect.startsWith("/")) {
          router.push(d.redirect);
          router.refresh();
        } else window.location.assign(d.redirect);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : c.wrong);
      setBusy(false);
    }
  }

  if (places) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold">{c.pick}</p>
        {places.map((p) => (
          <a key={p.url} href={p.url} className="btn btn-outline w-full justify-between">
            {p.label}
          </a>
        ))}
      </div>
    );
  }

  if (step === "code") {
    return (
      <div className="space-y-4">
        {devCode ? (
          <p className="text-xs rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2">
            {c.sentDev} <span className="font-semibold">{devCode}</span>
          </p>
        ) : (
          <p role="status" className="text-sm rounded-lg bg-[var(--surface-2)] text-[var(--ink-2)] px-3 py-2">
            {c.sent}
          </p>
        )}
        <div>
          <p className="block text-sm font-medium text-foreground/70 mb-2">{c.code}</p>
          <OtpInput
            value={code}
            onChangeAction={(v) => {
              setCode(v);
              if (v.length === 6 && !busy) void verify(v);
            }}
            autoFocus
            label={c.code}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-[var(--risk-text)]">
            {error}
          </p>
        )}
        <button type="button" className="btn btn-kesar w-full" disabled={busy || code.length !== 6} onClick={() => verify()}>
          {busy ? c.wait : c.verify}
        </button>
        <div className="flex justify-between text-sm">
          <button type="button" className="text-[var(--accent-text)] min-h-[44px]" onClick={() => void send()} disabled={busy}>
            {c.resend}
          </button>
          <button
            type="button"
            className="text-[var(--accent-text)] min-h-[44px]"
            onClick={() => {
              setStep("email");
              setError(null);
            }}
          >
            {c.other}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <label className="block">
        <span className="block text-sm font-medium text-foreground/70 mb-1">{c.label}</span>
        <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      {error && (
        <p role="alert" className="text-sm text-[var(--risk-text)]">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-kesar w-full" disabled={busy || !email.trim()}>
        {busy ? c.wait : c.send}
      </button>
      <p className="text-xs text-[var(--muted)]">{hint ?? c.hint}</p>
    </form>
  );
}
