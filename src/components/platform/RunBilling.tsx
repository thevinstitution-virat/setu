"use client";

import { useState } from "react";
import { errText, send } from "@/components/admin/AdminKit";
import { ErrLine, num, useIsOwner } from "./kit";

type Result = {
  billing: { trialsConverted: number; trialsLapsed: number; invoiced: number; reminders: number; suspended: number };
  lifecycle: { purged: string[]; exportsExpired: number };
};

/** OWNER only: run the daily billing and deletion job now. Safe to repeat. */
export default function RunBilling({ onDone }: { onDone?: () => void }) {
  const owner = useIsOwner();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  if (!owner) return null;

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await send<Result>("/api/platform/run", "POST"));
      onDone?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const b = result?.billing;
  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <p className="font-semibold text-sm">Daily billing job</p>
          <p className="text-xs text-[var(--muted)]">Trials, invoices, reminders, pausing for unpaid bills, and scheduled deletions. Safe to run more than once.</p>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run daily billing now"}
        </button>
      </div>
      {b && result && (
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
          {(
            [
              ["Trials converted", b.trialsConverted],
              ["Trials lapsed", b.trialsLapsed],
              ["Invoices issued", b.invoiced],
              ["Reminders sent", b.reminders],
              ["Businesses paused", b.suspended],
              ["Businesses deleted", result.lifecycle.purged.length],
              ["Copies expired", result.lifecycle.exportsExpired],
            ] as const
          ).map(([k, v]) => (
            <li key={k} className="rounded-xl bg-ink/5 px-3 py-2">
              <span className="block font-heading font-bold text-lg">{num(v)}</span>
              <span className="block text-xs text-[var(--muted)]">{k}</span>
            </li>
          ))}
        </ul>
      )}
      <ErrLine text={error} />
    </div>
  );
}
