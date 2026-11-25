"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, Field, Sheet, errText, send, useFetch } from "@/components/admin/AdminKit";
import { addDay, daysInclusive, istDay } from "@/lib/field-math";
import { LEAVE_TYPES, type LeaveType } from "@/lib/field-settings";
import { dayText, fieldChanged, type LeaveRequest, type LeaveStatus } from "./kit";

const STATUS: Record<LeaveStatus, [string, string]> = {
  PENDING: ["Waiting", "st-placed"],
  APPROVED: ["Approved", "st-delivered"],
  REJECTED: ["Refused", "st-cancelled"],
  CANCELLED: ["Cancelled", "st-confirmed"],
};

const range = (l: { fromDate: string; toDate: string }) =>
  l.fromDate === l.toDate ? dayText(l.fromDate, true) : `${dayText(l.fromDate)} to ${dayText(l.toDate)}`;

/** My leave: the list with its status, "Ask for leave", and cancel while it can still be cancelled. */
export default function LeaveCard() {
  const { data, error, reload } = useFetch<{ leave: LeaveRequest[] }>("/api/field/leave");
  const [asking, setAsking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; text: string } | null>(null);
  const today = istDay();

  async function cancel(id: string) {
    setBusyId(id);
    setRowError(null);
    try {
      await send(`/api/field/leave/${id}`, "PATCH", { action: "cancel" });
      reload();
      fieldChanged();
    } catch (e) {
      setRowError({ id, text: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  const leave = data?.leave ?? [];

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Leave</p>
          <p className="font-bold text-sm mt-0.5">Your leave requests</p>
        </div>
        <button type="button" className="btn btn-kesar btn-sm min-h-[44px] shrink-0" onClick={() => setAsking(true)}>
          <Icon name="plus" className="h-4 w-4" /> Ask for leave
        </button>
      </div>

      {error && !data ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : !data ? (
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      ) : leave.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">You haven&apos;t asked for any leave yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {leave.map((l) => {
            const [label, cls] = STATUS[l.status];
            const canCancel = l.status === "PENDING" || (l.status === "APPROVED" && l.fromDate > today);
            return (
              <li key={l.id} className="py-3 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm">{range(l)}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {LEAVE_TYPES[l.type as LeaveType] ?? l.type} · {l.days} day{l.days === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className={`st ${cls} text-xs px-2.5 py-1 rounded-full shrink-0`}>{label}</span>
                </div>
                {l.reason && <p className="text-xs text-[var(--ink-2)]">{l.reason}</p>}
                {l.decisionNote && (
                  <p className="text-xs text-[var(--muted)]">
                    {l.decidedBy?.name ? `${l.decidedBy.name}: ` : ""}
                    {l.decisionNote}
                  </p>
                )}
                {canCancel && (
                  <button
                    type="button"
                    className="btn btn-quiet btn-xs min-h-[36px]"
                    disabled={busyId === l.id}
                    onClick={() => cancel(l.id)}
                  >
                    {busyId === l.id ? "Cancelling…" : "Cancel this leave"}
                  </button>
                )}
                {rowError?.id === l.id && <p className="text-xs text-[var(--risk-text)]">{rowError.text}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {asking && (
        <AskLeaveSheet
          onClose={() => setAsking(false)}
          onSaved={() => {
            setAsking(false);
            reload();
            fieldChanged();
          }}
        />
      )}
    </div>
  );
}

function AskLeaveSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const today = istDay();
  const [from, setFrom] = useState(addDay(today, 1));
  const [to, setTo] = useState(addDay(today, 1));
  const [type, setType] = useState<LeaveType>("casual");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = from && to && to >= from ? daysInclusive(from, to) : 0;

  async function save() {
    setError(null);
    if (!from || !to) return setError("Pick the leave dates");
    if (to < from) return setError("The last day is before the first day");
    setBusy(true);
    try {
      await send("/api/field/leave", "POST", { fromDate: from, toDate: to, type, reason: reason.trim() || undefined });
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Ask for leave"
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet flex-1 min-h-[44px]" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar flex-[2] min-h-[44px]" onClick={save} disabled={busy}>
              {busy ? "Sending…" : days ? `Ask for ${days} day${days === 1 ? "" : "s"}` : "Ask for leave"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day">
          <input
            type="date"
            className="input"
            value={from}
            min={addDay(today, -7)}
            onChange={(e) => {
              setFrom(e.target.value);
              if (!to || to < e.target.value) setTo(e.target.value);
            }}
          />
        </Field>
        <Field label="Last day">
          <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Kind of leave">
        <select className="input" value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
          {(Object.keys(LEAVE_TYPES) as LeaveType[]).map((k) => (
            <option key={k} value={k}>
              {LEAVE_TYPES[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason (optional)" hint="Your supervisor sees this.">
        <textarea className="input min-h-[96px]" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Sheet>
  );
}
