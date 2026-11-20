"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { Field, errText, send } from "@/components/admin/AdminKit";
import { CopyLine } from "@/components/admin/CopyButton";
import { ErrLine, Section, StatusChip, useIsOwner, when } from "./kit";
import type { SupportRow, TenantData } from "./tenant-types";

function sessionState(s: SupportRow) {
  const now = Date.now();
  if (s.endedAt) return { label: "Ended", tone: undefined };
  if (new Date(s.expiresAt).getTime() <= now) return { label: "Ran out", tone: undefined };
  if (!s.usedAt) return { label: "Link not used", tone: "genda" as const };
  return { label: "Running", tone: "mint" as const };
}

/** Start a support session (single-use sign-in link) and see past ones. */
export default function TenantSupport({ data, onChanged }: { data: TenantData; onChanged: () => void }) {
  const owner = useIsOwner();
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"READ" | "WRITE">("READ");
  const [minutes, setMinutes] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string; mode: string } | null>(null);
  const closed = data.tenant.status === "CLOSED";

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setLink(null);
    try {
      const r = await send<{ id: string; url: string; expiresAt: string }>(`/api/platform/tenants/${data.tenant.id}/support`, "POST", {
        reason: reason.trim(),
        mode,
        minutes: Number(minutes),
      });
      setLink({ url: r.url, expiresAt: r.expiresAt, mode });
      setReason("");
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Support access" sub="Work inside this business with a reason. The business sees every session in its audit log and a banner while it runs.">
      {link && (
        <div className="card p-4 space-y-2 !bg-[var(--genda-tint)]">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Icon name="alert" className="h-4 w-4 text-[var(--genda-text)]" /> Sign-in link ({link.mode === "WRITE" ? "can change things" : "read only"})
          </p>
          <p className="text-sm text-[var(--ink-2)]">Single use and expires in 5 minutes. Open it in a private window. The session itself lasts until {when(link.expiresAt, true)}.</p>
          <CopyLine value={link.url} />
          <div className="flex flex-wrap gap-2">
            <a href={link.url} target="_blank" rel="noreferrer" className="btn btn-primary btn-xs">
              Open now
            </a>
            <button type="button" className="btn btn-quiet btn-xs" onClick={() => setLink(null)}>
              Done
            </button>
          </div>
        </div>
      )}

      {!closed && (
        <form onSubmit={start} className="space-y-3">
          <Field label="Reason" hint="At least 5 characters. The business sees it.">
            <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner asked for help with invoice settings (call of 19 Nov)" />
          </Field>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Access">
              <select className="input !w-auto" value={mode} onChange={(e) => setMode(e.target.value as "READ" | "WRITE")}>
                <option value="READ">Read only</option>
                {owner && <option value="WRITE">Can change things</option>}
              </select>
            </Field>
            <Field label="Minutes" hint="5 to 120">
              <input className="input !w-24" type="number" min={5} max={120} step={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || reason.trim().length < 5}>
              {busy ? "Starting…" : "Start session"}
            </button>
          </div>
        </form>
      )}
      <ErrLine text={error} />

      {data.supportSessions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-bold text-[var(--muted)] uppercase tracking-wide">Past sessions</p>
          <ul className="divide-y divide-[var(--line)]">
            {data.supportSessions.map((s) => {
              const st = sessionState(s);
              return (
                <li key={s.id} className="py-2 flex flex-wrap items-start gap-x-3 gap-y-1 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="break-words">{s.reason}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {s.by} · {when(s.startedAt, true)} to {when(s.endedAt ?? s.expiresAt, true)}
                    </p>
                  </div>
                  <span className="flex gap-1.5">
                    <StatusChip value={s.mode} />
                    <StatusChip value="x" label={st.label} tone={st.tone} />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Section>
  );
}
