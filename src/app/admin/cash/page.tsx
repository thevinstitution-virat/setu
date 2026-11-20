"use client";

import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { formatINR, toPaise } from "@/lib/money";

type Row = {
  id: string;
  name: string;
  role: "DELIVERY_AGENT" | "SALES_AGENT" | string;
  phone: string | null;
  active: boolean;
  cashInHand: number;
  collected24h: number;
  lastHandoverAt: string | null;
};

type Handover = {
  id: string;
  staffUserId: string;
  staff: { name: string };
  expected: number;
  counted: number;
  /** expected − counted; positive = short. */
  variance: number;
  note: string | null;
  createdAt: string;
};

type Data = { rows: Row[]; handovers: Handover[]; officeCash: number; totalWithStaff: number };

const ROLE_LABEL: Record<string, string> = { DELIVERY_AGENT: "Delivery", SALES_AGENT: "Sales" };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as T;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** ₹ text → paise, or null when blank / not a number. */
function parseRupees(s: string): number | null {
  if (!s.trim()) return null;
  try {
    return toPaise(s);
  } catch {
    return null;
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function ago(iso: string | null) {
  if (!iso) return "Never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function VarianceChip({ variance }: { variance: number }) {
  if (variance === 0) return <span className="chip chip-mint">Exact</span>;
  if (variance > 0) return <span className="chip chip-kesar">Short {formatINR(variance)}</span>;
  return <span className="chip chip-genda">Over {formatINR(-variance)}</span>;
}

export default function CashPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; kind: "handover" | "writeoff" } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/api/admin/cash"));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Shortage still on someone's cash in hand from their latest handover. */
  function shortageOf(r: Row) {
    const last = data?.handovers.find((h) => h.staffUserId === r.id);
    if (!last || last.variance <= 0 || r.cashInHand <= 0) return 0;
    return Math.min(last.variance, r.cashInHand);
  }

  async function finished(message: string) {
    setOpen(null);
    setDone(message);
    await load();
  }

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="page-head">
        <div>
          <p className="page-kick">Money</p>
          <h1 className="page-title">Cash with staff</h1>
          <p className="page-sub">Cash your team collected and has not handed in yet. Count it when they come back.</p>
        </div>
        <button className="btn btn-quiet btn-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && (
        <div className="grid grid-cols-2 gap-3 max-w-xl">
          <div className="card p-4 flex items-center gap-3">
            <span className="icon-tile bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
              <Icon name="users" />
            </span>
            <div className="min-w-0">
              <p className="stat-num !text-2xl truncate">{formatINR(data.totalWithStaff, { whole: true })}</p>
              <p className="stat-lbl !mt-1">With staff</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-3">
            <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
              <Icon name="cash" />
            </span>
            <div className="min-w-0">
              <p className="stat-num !text-2xl truncate">{formatINR(data.officeCash, { whole: true })}</p>
              <p className="stat-lbl !mt-1">Office cash</p>
            </div>
          </div>
        </div>
      )}

      {done && (
        <p className="text-sm text-[var(--mint-text)] flex items-center gap-1.5">
          <Icon name="check" className="h-4 w-4" /> {done}
        </p>
      )}

      {data && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[var(--line)]">
            <p className="font-heading font-bold">Staff</p>
          </div>
          {rows.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">No sales or delivery staff yet.</p>}
          {rows.length > 0 && (
            <div className="hidden md:grid grid-cols-[1.6fr_1fr_1fr_1fr_12rem] gap-x-3 px-4 py-2 text-xs font-bold text-[var(--muted)] border-b border-[var(--line)]">
              <span>Name</span>
              <span>Cash in hand</span>
              <span>Collected, last 24 hours</span>
              <span>Last handover</span>
              <span />
            </div>
          )}
          <div className="divide-y divide-[var(--line)]">
            {rows.map((r) => {
              const short = shortageOf(r);
              return (
                <div key={r.id} className="px-4 py-3.5 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr_12rem] items-center gap-x-3 gap-y-2">
                    <div className="col-span-2 md:col-span-1 min-w-0">
                      <p className="font-bold truncate">
                        {r.name}
                        {!r.active && <span className="text-xs font-normal text-[var(--muted)]"> · inactive</span>}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {ROLE_LABEL[r.role] ?? r.role}
                        {r.phone && ` · ${r.phone}`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[var(--muted)] md:hidden">Cash in hand</p>
                      <p className={`font-bold ${r.cashInHand > 0 ? "" : "text-[var(--muted)]"}`}>{formatINR(r.cashInHand)}</p>
                      {short > 0 && <span className="chip chip-kesar mt-1">Short {formatINR(short)}</span>}
                    </div>
                    <div>
                      <p className="text-[11px] text-[var(--muted)] md:hidden">Collected, last 24 hours</p>
                      <p className="text-sm">{formatINR(r.collected24h)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[var(--muted)] md:hidden">Last handover</p>
                      <p className="text-sm">{ago(r.lastHandoverAt)}</p>
                    </div>
                    <div className="col-span-2 md:col-span-1 flex flex-wrap gap-2 md:justify-end">
                      <button
                        className="btn btn-mor btn-xs"
                        disabled={r.cashInHand <= 0}
                        onClick={() => setOpen(open?.id === r.id && open.kind === "handover" ? null : { id: r.id, kind: "handover" })}
                      >
                        Receive cash
                      </button>
                      {short > 0 && (
                        <button
                          className="btn btn-quiet btn-xs"
                          onClick={() => setOpen(open?.id === r.id && open.kind === "writeoff" ? null : { id: r.id, kind: "writeoff" })}
                        >
                          Write off
                        </button>
                      )}
                    </div>
                  </div>
                  {open?.id === r.id && open.kind === "handover" && (
                    <HandoverForm row={r} onCancel={() => setOpen(null)} onDone={finished} />
                  )}
                  {open?.id === r.id && open.kind === "writeoff" && (
                    <WriteOffForm row={r} shortage={short} onCancel={() => setOpen(null)} onDone={finished} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && (
        <div className="card overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[var(--line)]">
            <p className="font-heading font-bold">Recent handovers</p>
          </div>
          {data.handovers.length === 0 && <p className="px-4 py-6 text-sm text-[var(--muted)]">No handovers yet.</p>}
          <div className="divide-y divide-[var(--line)]">
            {data.handovers.map((h) => (
              <div key={h.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{h.staff.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    {when(h.createdAt)}
                    {h.note && ` · ${h.note}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-[var(--muted)]">
                    Expected <span className="text-[var(--ink-2)] font-bold">{formatINR(h.expected)}</span>
                  </span>
                  <span className="text-[var(--muted)]">
                    Counted <span className="text-[var(--ink-2)] font-bold">{formatINR(h.counted)}</span>
                  </span>
                  <VarianceChip variance={h.variance} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HandoverForm({ row, onCancel, onDone }: { row: Row; onCancel: () => void; onDone: (msg: string) => void }) {
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expected = row.cashInHand;
  const c = parseRupees(counted);
  const valid = c !== null && c >= 0;
  const variance = valid ? expected - c : 0;
  const over = valid && variance < 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || over) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "handover", staffUserId: row.id, counted: c, note: note.trim() || undefined }),
      });
      onDone(
        variance > 0
          ? `Received ${formatINR(c)} from ${row.name}. ${formatINR(variance)} short stays on their cash in hand.`
          : `Received ${formatINR(c)} from ${row.name}.`
      );
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-ink/5 p-3 space-y-3 max-w-lg">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm text-[var(--ink-2)]">Should have</p>
        <p className="font-heading font-bold text-lg">{formatINR(expected)}</p>
      </div>
      <label className="block">
        <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">Cash counted (₹)</span>
        <input
          className="input"
          inputMode="decimal"
          autoFocus
          placeholder="0"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 text-sm min-h-7">
        {counted.trim() && !valid && <span className="text-[#a8281e]">Enter an amount in rupees</span>}
        {valid && variance === 0 && <span className="chip chip-mint">Matches</span>}
        {valid && variance > 0 && (
          <>
            <span className="chip chip-kesar">Short {formatINR(variance)}</span>
            <span className="text-xs text-[var(--muted)]">This stays on their cash in hand until they hand it in or you write it off.</span>
          </>
        )}
        {over && (
          <>
            <span className="chip chip-genda">Over {formatINR(-variance)}</span>
            <span className="text-xs text-[#a8281e]">That is more than they hold. Count again, or check for a payment they have not entered.</span>
          </>
        )}
      </div>
      <label className="block">
        <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">Note (optional)</span>
        <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-kesar btn-sm" disabled={!valid || over || busy}>
          {busy ? "Saving…" : valid ? `Receive ${formatINR(c)}` : "Receive"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function WriteOffForm({
  row,
  shortage,
  onCancel,
  onDone,
}: {
  row: Row;
  shortage: number;
  onCancel: () => void;
  onDone: (msg: string) => void;
}) {
  const [amount, setAmount] = useState(String(shortage / 100));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const a = parseRupees(amount);
  const tooMuch = a !== null && a > row.cashInHand;
  const ok = a !== null && a > 0 && !tooMuch && note.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "writeoff", staffUserId: row.id, amount: a, note: note.trim() }),
      });
      onDone(`Wrote off ${formatINR(a)} for ${row.name}.`);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl bg-ink/5 p-3 space-y-3 max-w-lg">
      <p className="text-sm text-[var(--ink-2)]">
        Accept the shortage as a loss. It comes off {row.name}&apos;s cash in hand and is recorded as a cash shortage.
      </p>
      <label className="block">
        <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">Amount (₹)</span>
        <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {tooMuch && <span className="block text-xs text-[#a8281e] mt-1">They only hold {formatINR(row.cashInHand)}.</span>}
      </label>
      <label className="block">
        <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">Reason</span>
        <input
          className="input"
          maxLength={300}
          placeholder="e.g. Change given wrongly"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-danger btn-sm" disabled={!ok || busy}>
          {busy ? "Saving…" : "Write off"}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
