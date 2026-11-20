"use client";

import { useState } from "react";
import { Field, Flash, errText, send } from "@/components/admin/AdminKit";
import { ConfirmButton, ErrLine, Section, StatusChip, num, useIsOwner, when } from "./kit";
import type { TenantData } from "./tenant-types";

function size(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Data copies (exports) and the deletion request. */
export default function TenantDataPanel({ data, onChanged }: { data: TenantData; onChanged: () => void }) {
  const owner = useIsOwner();
  const t = data.tenant;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const closed = t.status === "CLOSED";

  async function run(key: string, method: "POST" | "DELETE", path: string, body: unknown, ok: string) {
    setBusy(key);
    setError(null);
    setFlash(null);
    try {
      await send(path, method, body);
      setFlash(ok);
      setReason("");
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Data" sub="A copy is downloaded by the business under Settings → Data. The platform never downloads it.">
      <Flash text={flash} />

      {data.exports.length > 0 ? (
        <ul className="divide-y divide-[var(--line)]">
          {data.exports.map((x) => (
            <li key={x.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="flex-1 min-w-0">
                {when(x.createdAt, true)}
                {x.forDeletion && <span className="text-xs text-[var(--muted)]"> · before deletion</span>}
              </span>
              <span className="text-xs text-[var(--muted)]">{[x.rows !== null ? `${num(x.rows)} rows` : "", size(x.bytes)].filter(Boolean).join(" · ")}</span>
              <StatusChip value={x.status} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted)]">No copies made yet.</p>
      )}

      {owner && !closed && (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={!!busy}
          onClick={() => run("export", "POST", `/api/platform/tenants/${t.id}/export`, undefined, "Copy queued. The business can download it when it is ready.")}
        >
          {busy === "export" ? "Queuing…" : "Make a data copy"}
        </button>
      )}

      {t.deleteAfter ? (
        <div className="rounded-2xl bg-[#fde4e1]/60 p-3 space-y-2">
          <p className="text-sm">
            <span className="font-semibold text-[#a8281e]">Deletion scheduled</span> for {when(t.deleteAfter, true)}
            {t.deleteRequestedAt && <span className="text-[var(--ink-2)]"> (asked {when(t.deleteRequestedAt)})</span>}
          </p>
          {!closed && (
            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => run("cancel", "DELETE", `/api/platform/tenants/${t.id}/deletion`, undefined, "Deletion cancelled")}>
              {busy === "cancel" ? "Working…" : "Cancel deletion"}
            </button>
          )}
        </div>
      ) : (
        owner &&
        !closed && (
          <div className="space-y-2 rounded-2xl border border-[#a8281e]/20 p-3">
            <p className="text-sm font-semibold text-[#a8281e]">Delete this business</p>
            <p className="text-xs text-[var(--muted)]">Only on the business&apos;s written request. A copy is made first; all data is removed 7 days later unless cancelled.</p>
            <Field label="Request">
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner's email of 18 Nov asking to close the account" />
            </Field>
            <ConfirmButton
              label="Schedule deletion"
              question={`Delete all of ${t.name}'s data in 7 days?`}
              yes="Yes, schedule it"
              busy={busy === "delete"}
              disabled={reason.trim().length < 5 || !!busy}
              onConfirm={() => run("delete", "POST", `/api/platform/tenants/${t.id}/deletion`, { reason: reason.trim() }, "Deletion scheduled")}
            />
          </div>
        )
      )}
      <ErrLine text={error} />
    </Section>
  );
}
