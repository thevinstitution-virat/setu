"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { errText, send, useFetch } from "@/components/admin/AdminKit";

type Workspaces = {
  current: { name: string };
  workspaces: { slug: string; name: string; role: string }[];
  canHop: boolean;
};

const ROLE: Record<string, string> = {
  SALES_AGENT: "Sales",
  DELIVERY_AGENT: "Delivery",
  SUPERVISOR: "Supervisor",
  ACCOUNTANT: "Accountant",
};

/**
 * "You also work for: X" when the same mobile number has a login in another
 * business. Switch opens it (straight in after an OTP sign-in, else its login
 * page with the number filled in). Shows nothing when there are none.
 */
export default function WorkspaceSwitcher() {
  const { data } = useFetch<Workspaces>("/api/auth/workspaces");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data || data.workspaces.length === 0) return null;

  async function hop(slug: string) {
    setBusy(slug);
    setError(null);
    try {
      const { url } = await send<{ url: string; signIn: boolean }>("/api/auth/handoff", "POST", { slug });
      window.location.assign(url);
    } catch (e) {
      setError(errText(e));
      setBusy(null);
    }
  }

  return (
    <div className="card p-4 space-y-2">
      <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">You also work for</p>
      <ul className="space-y-2">
        {data.workspaces.map((w) => (
          <li key={w.slug} className="flex items-center gap-3">
            <span className="icon-tile bg-[var(--accent-tint)] text-[var(--accent-text)]">
              <Icon name="share" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm truncate">{w.name}</p>
              <p className="text-xs text-[var(--muted)]">{ROLE[w.role] ?? w.role}</p>
            </div>
            <button
              type="button"
              className="btn btn-quiet btn-sm min-h-[44px] shrink-0"
              disabled={busy !== null}
              onClick={() => hop(w.slug)}
            >
              {busy === w.slug ? "Opening…" : "Switch"}
            </button>
          </li>
        ))}
      </ul>
      {!data.canHop && (
        <p className="text-xs text-[var(--muted)]">You will sign in there with your mobile number.</p>
      )}
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}
