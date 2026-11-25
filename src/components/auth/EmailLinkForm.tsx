"use client";

import { useState } from "react";

export type EmailLinkText = { label: string; send: string; wait: string; sent: string; again: string; hint: string; bad: string };

export const EMAIL_LINK_EN: EmailLinkText = {
  label: "Email address",
  send: "Email me a sign-in link",
  wait: "Please wait…",
  sent: "If that address can sign in anywhere, a link is on its way. Open it on this device. It works for 15 minutes, once. Check spam too.",
  again: "Use another address",
  hint: "One email with a link for each business your confirmed address belongs to (and the console, for the VBiz Pro team).",
  bad: "Enter a valid email address",
};

/**
 * "Email me a sign-in link" (main address and console): one email with a
 * one-click link per place the address may sign in. The answer never says
 * whether the address has a login.
 */
export default function EmailLinkForm({ text = EMAIL_LINK_EN, hint }: { text?: EmailLinkText; /** Replaces the line under the button (a server page can't spread EMAIL_LINK_EN: it is a client module). */ hint?: string }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError(text.bad);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/email-link/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? text.bad);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : text.bad);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm rounded-lg bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2">
          {text.sent}
        </p>
        <button
          type="button"
          className="text-sm text-[var(--accent-text)] w-full text-center min-h-[44px]"
          onClick={() => {
            setSent(false);
            setEmail("");
          }}
        >
          {text.again}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="block text-sm font-medium text-foreground/70 mb-1">{text.label}</span>
        <input className="input" type="email" autoComplete="email" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </label>
      {error && (
        <p role="alert" className="text-sm text-[var(--risk-text)]">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-kesar w-full" disabled={busy || !email.trim()}>
        {busy ? text.wait : text.send}
      </button>
      <p className="text-xs text-[var(--muted)]">{hint ?? text.hint}</p>
    </form>
  );
}
