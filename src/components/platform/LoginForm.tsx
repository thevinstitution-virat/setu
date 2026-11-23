"use client";

import { useState } from "react";
import { Field } from "@/components/admin/AdminKit";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not sign in");
      window.location.assign(data.redirect ?? "/platform");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4">
      <Field label="Email">
        <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Password">
        <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !email || !password}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center">
        <a href="/platform/login/forgot" className="text-sm font-semibold text-[var(--kesar-text)] hover:underline">
          Forgot password?
        </a>
      </p>
      <p className="text-xs text-[var(--muted)]">For the people who run the platform. Five wrong tries lock the address for 15 minutes.</p>
    </form>
  );
}
