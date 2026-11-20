"use client";

import { useState } from "react";
import { ErrorBox, Field, Sheet, errText, send, shortDate, useFetch } from "@/components/admin/AdminKit";
import { LEAVE_TYPES } from "@/lib/field-settings";
import { Empty, Loading, errorText, plural, roleText, shortDay } from "@/components/team/kit";

type Leave = {
  id: string;
  userId: string;
  fromDate: string;
  toDate: string;
  days: number;
  type: string;
  reason: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  user: { name: string; role: string };
  decidedBy: { name: string } | null;
};

const STATUS: Record<Leave["status"], { label: string; cls: string }> = {
  PENDING: { label: "Waiting", cls: "chip chip-genda" },
  APPROVED: { label: "Approved", cls: "chip chip-mint" },
  REJECTED: { label: "Refused", cls: "chip chip-kesar" },
  CANCELLED: { label: "Cancelled", cls: "chip" },
};

const typeText = (t: string) => (LEAVE_TYPES as Record<string, string>)[t] ?? t;
const range = (l: Leave) => (l.fromDate === l.toDate ? shortDay(l.fromDate) : `${shortDay(l.fromDate)} – ${shortDay(l.toDate)}`);

export default function TeamLeavePage() {
  const { data, error, reload } = useFetch<{ leave: Leave[] }>("/api/field/leave?team=1");
  const [refusing, setRefusing] = useState<Leave | null>(null);

  const all = data?.leave ?? [];
  const pending = all.filter((l) => l.status === "PENDING").sort((a, b) => a.fromDate.localeCompare(b.fromDate));
  const decided = all.filter((l) => l.status !== "PENDING");

  return (
    <div className="space-y-5">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Field team</p>
          <h1 className="page-title">Leave</h1>
          <p className="page-sub">Approve or refuse your team&apos;s leave.</p>
        </div>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <Loading />}

      {data && (
        <>
          <section className="space-y-3">
            <h2 className="font-heading font-bold text-xl">Waiting for you {pending.length > 0 && <span className="text-[var(--muted)]">({pending.length})</span>}</h2>
            {pending.length === 0 ? (
              <Empty title="No leave waiting" sub="New requests from your team show here." />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {pending.map((l) => (
                  <PendingCard key={l.id} l={l} onDone={reload} onRefuse={() => setRefusing(l)} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-heading font-bold text-xl">Decided</h2>
            {decided.length === 0 ? (
              <Empty title="Nothing decided yet" />
            ) : (
              <div className="card divide-y divide-[var(--line)]">
                {decided.map((l) => (
                  <DecidedRow key={l.id} l={l} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {refusing && (
        <RefuseSheet
          l={refusing}
          onClose={() => setRefusing(null)}
          onDone={() => {
            setRefusing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function Head({ l }: { l: Leave }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="font-heading font-bold truncate">{l.user.name}</p>
        <p className="text-xs text-[var(--muted)]">{roleText(l.user.role)}</p>
      </div>
      <span className={`${STATUS[l.status].cls} !py-0.5 !px-2 !text-[11.5px] shrink-0`}>{STATUS[l.status].label}</span>
    </div>
  );
}

function PendingCard({ l, onDone, onRefuse }: { l: Leave; onDone: () => void; onRefuse: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/field/leave/${l.id}`, "PATCH", { action: "approve" });
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-3 min-w-0">
      <Head l={l} />
      <div className="text-sm">
        <p className="font-semibold">
          {range(l)} · {plural(l.days, "day")}
        </p>
        <p className="text-[var(--ink-2)]">{typeText(l.type)}</p>
        {l.reason && <p className="text-[var(--ink-2)] mt-1 break-words">&ldquo;{l.reason}&rdquo;</p>}
        <p className="text-xs text-[var(--muted)] mt-1">Asked {shortDate(l.createdAt, true)}</p>
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn btn-kesar flex-1 !min-h-[44px]" disabled={busy} onClick={approve}>
          {busy ? "Approving…" : "Approve"}
        </button>
        <button type="button" className="btn btn-quiet flex-1 !min-h-[44px]" disabled={busy} onClick={onRefuse}>
          Refuse
        </button>
      </div>
      {error && <p className={errorText}>{error}</p>}
    </div>
  );
}

function DecidedRow({ l }: { l: Leave }) {
  return (
    <div className="p-4 space-y-1 min-w-0">
      <Head l={l} />
      <p className="text-sm">
        {range(l)} · {plural(l.days, "day")} · {typeText(l.type)}
      </p>
      {l.reason && <p className="text-xs text-[var(--ink-2)] break-words">Reason: {l.reason}</p>}
      {(l.decidedBy || l.decidedAt) && (
        <p className="text-xs text-[var(--muted)]">
          {STATUS[l.status].label}
          {l.decidedBy ? ` by ${l.decidedBy.name}` : ""}
          {l.decidedAt ? ` on ${shortDate(l.decidedAt)}` : ""}
        </p>
      )}
      {l.decisionNote && <p className="text-xs text-[var(--ink-2)] break-words">Note: {l.decisionNote}</p>}
    </div>
  );
}

function RefuseSheet({ l, onClose, onDone }: { l: Leave; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refuse() {
    if (!note.trim()) return setError("Say why the leave is refused");
    setBusy(true);
    setError(null);
    try {
      await send(`/api/field/leave/${l.id}`, "PATCH", { action: "reject", note: note.trim() });
      onDone();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Refuse leave"
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className={errorText}>{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet !min-h-[44px]" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar !min-h-[44px]" onClick={refuse} disabled={busy}>
              {busy ? "Refusing…" : "Refuse leave"}
            </button>
          </div>
        </div>
      }
    >
      <p className="text-sm">
        <b>{l.user.name}</b>: {range(l)} · {plural(l.days, "day")} · {typeText(l.type)}
      </p>
      <Field label="Why? (they will see this)">
        <textarea
          className="input min-h-[96px]"
          maxLength={300}
          value={note}
          autoFocus
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Stock count that week, please pick other days"
        />
      </Field>
    </Sheet>
  );
}
