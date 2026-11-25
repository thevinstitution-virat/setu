"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";

type Method = "CASH" | "UPI" | "CHEQUE" | "BANK" | "ONLINE" | "WALLET" | "CREDIT_NOTE";
type State = "PENDING_VERIFICATION" | "POST_DATED" | "CONFIRMED" | "REJECTED" | "REVERSED";
type ChequeStatus = "RECEIVED" | "DEPOSITED" | "CLEARED" | "BOUNCED";

type Payment = {
  id: string;
  number: string;
  purpose: "DUES" | "WALLET";
  method: Method;
  state: State;
  amount: number;
  reference: string | null;
  proofKey: string | null;
  note: string | null;
  collectedAt: string;
  rejectReason: string | null;
  retailer: { id: string; outletName: string; user: { name: string; phone: string } | null };
  collectedBy: { id: string; name: string; role: string } | null;
  cheque: { number: string; bank: string; chequeDate: string; status: ChequeStatus } | null;
  photoCheck?: PhotoCheck | null;
};

/** A3: what the photo check found (only a note; a person verifies). */
type PhotoCheck = { verdict: "ok" | "warn" | "bad"; flags: string[]; source: "rules" | "ai"; summary: string; notes: string[]; checkedAt: string };

type Cheque = {
  id: string;
  number: string;
  bank: string;
  chequeDate: string;
  status: ChequeStatus;
  depositedAt: string | null;
  clearedAt: string | null;
  bouncedAt: string | null;
  bounceReason: string | null;
  createdAt: string;
  payment: {
    id: string;
    number: string;
    amount: number;
    state: State;
    collectedAt: string;
    retailer: { id: string; outletName: string };
    collectedBy: { name: string } | null;
  };
};

const TABS = [
  { key: "verify", label: "To verify" },
  { key: "all", label: "All payments" },
  { key: "cheques", label: "Cheques" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const METHOD_LABEL: Record<Method, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CHEQUE: "Cheque",
  BANK: "Bank transfer",
  ONLINE: "Online (gateway)",
  WALLET: "Wallet",
  CREDIT_NOTE: "Credit note",
};

const STATE_LABEL: Record<State, string> = {
  PENDING_VERIFICATION: "To verify",
  POST_DATED: "Post-dated, held",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  REVERSED: "Reversed",
};

const STATE_CHIP: Record<State, string> = {
  PENDING_VERIFICATION: "chip-genda",
  POST_DATED: "chip-genda",
  CONFIRMED: "chip-mint",
  REJECTED: "chip-kesar",
  REVERSED: "",
};

const CHEQUE_LABEL: Record<ChequeStatus, string> = {
  RECEIVED: "In hand",
  DEPOSITED: "Deposited",
  CLEARED: "Cleared",
  BOUNCED: "Bounced",
};

const CHEQUE_CHIP: Record<ChequeStatus, string> = {
  RECEIVED: "chip-genda",
  DEPOSITED: "chip-mor",
  CLEARED: "chip-mint",
  BOUNCED: "chip-kesar",
};

// ───────────────────────────── helpers ─────────────────────────────

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data as T;
}

function post<T>(url: string, body: Record<string, unknown>) {
  return api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

/** Today in India as YYYY-MM-DD. */
function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
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

function dateOnly(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** Whole IST calendar days from a to b. */
function daysBetween(a: string | Date, b: string | Date) {
  const d = (x: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(x));
  return Math.round((Date.parse(d(b)) - Date.parse(d(a))) / 86_400_000);
}

const fileUrl = (key: string) => `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;

// ───────────────────────────── page ─────────────────────────────

export default function PaymentsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <Payments />
    </Suspense>
  );
}

function Payments() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = raw === "all" || raw === "cheques" ? raw : "verify";
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [proof, setProof] = useState<string | null>(null);

  function pick(t: Tab) {
    router.replace(t === "verify" ? pathname : `${pathname}?tab=${t}`, { scroll: false });
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Money</p>
        <h1 className="page-title">Payments</h1>
        <p className="page-sub">Check UPI payments retailers report, see what came in, and track cheques.</p>
      </div>

      <div className="flex rounded-2xl p-1 bg-ink/5 max-w-md" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => pick(t.key)}
            className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${
              tab === t.key ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "text-[var(--ink-2)]"
            }`}
          >
            {t.label}
            {t.key === "verify" && pendingCount ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      {tab === "verify" && <VerifyTab onCount={setPendingCount} onProof={setProof} />}
      {tab === "all" && <AllTab onProof={setProof} />}
      {tab === "cheques" && <ChequesTab />}

      {proof && <ProofViewer src={proof} onClose={() => setProof(null)} />}
    </div>
  );
}

function ProofViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4 gap-3"
      role="dialog"
      aria-label="Payment proof"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Payment proof" className="max-h-[80vh] max-w-full rounded-xl bg-white object-contain" />
      <div className="flex gap-2">
        <a href={src} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" onClick={(e) => e.stopPropagation()}>
          Open in new tab
        </a>
        <button className="btn btn-quiet btn-sm !bg-white" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

function ProofThumb({ proofKey, onProof }: { proofKey: string | null; onProof: (src: string) => void }) {
  if (!proofKey) {
    return (
      <span className="h-16 w-16 shrink-0 rounded-xl bg-ink/5 text-[10px] text-[var(--muted)] flex items-center justify-center text-center">
        No proof
      </span>
    );
  }
  const src = fileUrl(proofKey);
  return (
    <button
      type="button"
      onClick={() => onProof(src)}
      className="h-16 w-16 shrink-0 rounded-xl overflow-hidden border border-[var(--line)] bg-white"
      aria-label="Open payment proof"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-full w-full object-cover" loading="lazy" />
    </button>
  );
}

const VERDICT_CHIP = { ok: "chip-mint", warn: "chip-genda", bad: "chip-kesar" } as const;

/** The photo check under a payment to verify, with "Check again". */
function PhotoCheckLine({ p, onChecked }: { p: Payment; onChecked: (c: PhotoCheck) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!p.proofKey) return null;
  const c = p.photoCheck;
  async function again() {
    setBusy(true);
    setErr(null);
    try {
      const r = await post<{ photoCheck: PhotoCheck }>(`/api/payments/${p.id}/photo-check`, {});
      onChecked(r.photoCheck);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded-xl bg-ink/5 px-3 py-2 text-sm space-y-1" aria-label="Photo check">
      <div className="flex flex-wrap items-center gap-2">
        {c ? (
          <>
            <span className={`chip text-xs ${VERDICT_CHIP[c.verdict]}`}>
              <Icon name={c.verdict === "ok" ? "check" : "alert"} className="h-3.5 w-3.5" /> {c.verdict === "ok" ? "Photo check" : c.verdict === "bad" ? "Doesn't match" : "Look closer"}
            </span>
            <span className="min-w-0 flex-1 text-[var(--ink-2)]">{c.summary}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-[var(--muted)]">Photo not checked yet</span>
        )}
        <button type="button" className="btn btn-quiet btn-xs" onClick={again} disabled={busy}>
          {busy ? "Checking…" : c ? "Check again" : "Check now"}
        </button>
      </div>
      {c && c.verdict !== "ok" && c.notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-[var(--ink-2)]">
          {c.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {c && <p className="text-[11px] text-[var(--muted)]">{c.source === "ai" ? "Read by AI from the photo. You still decide." : "Checked for a reused photo and UTR (AI reading is off)."}</p>}
      {err && <p className="text-xs text-[var(--accent-text)]">{err}</p>}
    </div>
  );
}

function PurposeChip({ p }: { p: Payment["purpose"] }) {
  return p === "WALLET" ? <span className="chip chip-mor">Wallet top-up</span> : <span className="chip">Dues</span>;
}

/** Inline "reason" box used by reject / reverse / bounce. */
function ReasonForm({
  label,
  quick,
  busy,
  confirmText,
  onCancel,
  onSubmit,
}: {
  label: string;
  quick: string[];
  busy: boolean;
  confirmText: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <form
      className="rounded-xl bg-ink/5 p-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSubmit(reason.trim());
      }}
    >
      <label className="block text-xs font-bold text-[var(--ink-2)]">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => setReason(q)}>
            {q}
          </button>
        ))}
      </div>
      <input
        className="input"
        value={reason}
        maxLength={200}
        autoFocus
        placeholder="Write a short reason"
        onChange={(e) => setReason(e.target.value)}
      />
      <div className="flex gap-2">
        <button type="submit" className="btn btn-danger btn-sm" disabled={!ok || busy}>
          {busy ? "Saving…" : confirmText}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
          Back
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────── To verify ─────────────────────────────

function VerifyTab({ onCount, onProof }: { onCount: (n: number) => void; onProof: (src: string) => void }) {
  const [rows, setRows] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ payments: Payment[] }>("/api/payments?state=PENDING_VERIFICATION&take=500");
      const list = [...data.payments].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
      setRows(list);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (rows) onCount(rows.length);
  }, [rows, onCount]);

  async function act(p: Payment, action: "verify" | "reject", reason?: string) {
    setBusyId(p.id);
    setRowError(null);
    try {
      await post(`/api/payments/${p.id}`, { action, reason });
      setRows((r) => (r ?? []).filter((x) => x.id !== p.id));
      setRejecting(null);
      setDone(`${action === "verify" ? "Verified" : "Rejected"} ${formatINR(p.amount)} from ${p.retailer.outletName}`);
    } catch (e) {
      setRowError({ id: p.id, message: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!rows) return <p className="text-sm text-[var(--muted)]">Loading…</p>;

  const total = rows.reduce((t, r) => t + r.amount, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-[var(--ink-2)]">
          {rows.length === 0 ? (
            "Nothing waiting."
          ) : (
            <>
              <span className="font-bold">{rows.length}</span> waiting · {formatINR(total)} · oldest first
            </>
          )}
        </p>
        <button className="btn btn-quiet btn-xs" onClick={load}>
          Refresh
        </button>
      </div>
      {done && (
        <p className="text-sm text-[var(--success-text)] flex items-center gap-1.5">
          <Icon name="check" className="h-4 w-4" /> {done}
        </p>
      )}

      {rows.length === 0 && (
        <div className="card p-6 text-center text-sm text-[var(--muted)]">
          All caught up. New UPI payments from retailers will show here.
        </div>
      )}

      {rows.map((p) => (
        <div key={p.id} className="card p-4 space-y-3">
          <div className="flex gap-3">
            <ProofThumb proofKey={p.proofKey} onProof={onProof} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold truncate">{p.retailer.outletName}</p>
                <p className="font-heading font-bold text-lg leading-none shrink-0">{formatINR(p.amount)}</p>
              </div>
              <p className="text-xs text-[var(--muted)] mt-1">
                {METHOD_LABEL[p.method]} · {when(p.collectedAt)} · {ago(p.collectedAt)}
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <PurposeChip p={p.purpose} />
                {p.reference ? (
                  <span className="chip font-mono select-all">UTR {p.reference}</span>
                ) : (
                  <span className="chip chip-kesar">No UTR</span>
                )}
              </div>
            </div>
          </div>
          {p.note && <p className="text-sm text-[var(--ink-2)]">&ldquo;{p.note}&rdquo;</p>}
          <PhotoCheckLine p={p} onChecked={(c) => setRows((r) => (r ?? []).map((x) => (x.id === p.id ? { ...x, photoCheck: c } : x)))} />

          {rejecting === p.id ? (
            <ReasonForm
              label="Why reject this payment?"
              quick={["Not received", "Wrong amount", "UTR not found", "Duplicate"]}
              busy={busyId === p.id}
              confirmText="Reject payment"
              onCancel={() => setRejecting(null)}
              onSubmit={(reason) => act(p, "reject", reason)}
            />
          ) : (
            <div className="flex gap-2">
              <button className="btn btn-mor btn-sm flex-1 sm:flex-none" disabled={busyId === p.id} onClick={() => act(p, "verify")}>
                <Icon name="check" className="h-4 w-4" />
                {busyId === p.id ? "Saving…" : "Verify"}
              </button>
              <button className="btn btn-danger btn-sm" disabled={busyId === p.id} onClick={() => setRejecting(p.id)}>
                Reject
              </button>
            </div>
          )}
          {rowError?.id === p.id && <p className="text-sm text-[var(--risk-text)]">{rowError.message}</p>}
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────── All payments ─────────────────────────────

function AllTab({ onProof }: { onProof: (src: string) => void }) {
  const [from, setFrom] = useState(todayIST);
  const [to, setTo] = useState(todayIST);
  const [method, setMethod] = useState<Method | "">("");
  const [state, setState] = useState<State | "">("");
  const [data, setData] = useState<{ payments: Payment[]; totals: Partial<Record<Method, number>> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: string; kind: "reject" | "reverse" } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const rangeError = !from || !to ? "Pick both dates" : to < from ? "The end date is before the start date" : null;

  const load = useCallback(async () => {
    if (rangeError) return;
    const qs = new URLSearchParams({ from, to, take: "500" });
    if (method) qs.set("method", method);
    if (state) qs.set("state", state);
    try {
      setData(await api(`/api/payments?${qs}`));
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [from, to, method, state, rangeError]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(p: Payment, action: "verify" | "reject" | "reverse", reason?: string) {
    setBusyId(p.id);
    setRowError(null);
    try {
      await post(`/api/payments/${p.id}`, { action, reason });
      setOpen(null);
      await load();
    } catch (e) {
      setRowError({ id: p.id, message: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  const totals = Object.entries(data?.totals ?? {}).filter(([, v]) => v) as [Method, number][];
  const grand = totals.reduce((t, [, v]) => t + v, 0);
  const payments = data?.payments ?? [];

  function actions(p: Payment) {
    if (open?.id === p.id) {
      return (
        <ReasonForm
          label={open.kind === "reject" ? "Why reject this payment?" : "Why reverse this payment?"}
          quick={open.kind === "reject" ? ["Not received", "Wrong amount", "UTR not found"] : ["Entered by mistake", "Wrong retailer", "Wrong amount"]}
          busy={busyId === p.id}
          confirmText={open.kind === "reject" ? "Reject payment" : "Reverse payment"}
          onCancel={() => setOpen(null)}
          onSubmit={(reason) => act(p, open.kind, reason)}
        />
      );
    }
    if (p.state === "PENDING_VERIFICATION") {
      return (
        <div className="flex gap-2">
          <button className="btn btn-mor btn-xs" disabled={busyId === p.id} onClick={() => act(p, "verify")}>
            Verify
          </button>
          <button className="btn btn-danger btn-xs" disabled={busyId === p.id} onClick={() => setOpen({ id: p.id, kind: "reject" })}>
            Reject
          </button>
        </div>
      );
    }
    if ((p.state === "CONFIRMED" || p.state === "POST_DATED") && (!p.cheque || p.cheque.status === "RECEIVED")) {
      return (
        <button className="btn btn-quiet btn-xs" disabled={busyId === p.id} onClick={() => setOpen({ id: p.id, kind: "reverse" })}>
          {p.state === "POST_DATED" ? "Give back" : "Reverse"}
        </button>
      );
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <label className="block">
          <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">From</span>
          <input type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">To</span>
          <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="block">
          <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">Method</span>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as Method | "")}>
            <option value="">All methods</option>
            {(Object.keys(METHOD_LABEL) as Method[]).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs font-bold text-[var(--ink-2)] mb-1">State</span>
          <select className="input" value={state} onChange={(e) => setState(e.target.value as State | "")}>
            <option value="">All states</option>
            {(Object.keys(STATE_LABEL) as State[]).map((s) => (
              <option key={s} value={s}>
                {STATE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {rangeError && <p className="col-span-full text-sm text-[var(--risk-text)]">{rangeError}</p>}
      </div>

      {error && <ErrorBox message={error} onRetry={load} />}

      {data && (
        <div className="card p-4 space-y-3">
          <p className="text-xs font-bold text-[var(--ink-2)]">Confirmed money in this period</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded-xl bg-[var(--success-tint)] p-3">
              <p className="stat-num !text-xl">{formatINR(grand, { whole: true })}</p>
              <p className="stat-lbl">Total</p>
            </div>
            {totals.map(([m, v]) => (
              <div key={m} className="rounded-xl bg-ink/5 p-3">
                <p className="stat-num !text-xl">{formatINR(v, { whole: true })}</p>
                <p className="stat-lbl">{METHOD_LABEL[m]}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && payments.length === 0 && (
        <div className="card p-6 text-center text-sm text-[var(--muted)]">No payments match these filters.</div>
      )}

      {payments.length > 0 && (
        <>
          {/* Wide screens: table */}
          <div className="card overflow-hidden hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
                <tr>
                  <th className="px-4 py-2.5 font-bold">Retailer</th>
                  <th className="px-3 py-2.5 font-bold">Method</th>
                  <th className="px-3 py-2.5 font-bold text-right">Amount</th>
                  <th className="px-3 py-2.5 font-bold">Reference</th>
                  <th className="px-3 py-2.5 font-bold">Collected</th>
                  <th className="px-3 py-2.5 font-bold">State</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {payments.map((p) => (
                  <tr key={p.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-bold">{p.retailer.outletName}</p>
                      <p className="text-xs text-[var(--muted)]">
                        {p.number}
                        {p.purpose === "WALLET" && " · Wallet top-up"}
                      </p>
                    </td>
                    <td className="px-3 py-3">{METHOD_LABEL[p.method]}</td>
                    <td className="px-3 py-3 text-right font-bold whitespace-nowrap">{formatINR(p.amount)}</td>
                    <td className="px-3 py-3">
                      <span className="font-mono text-xs break-all">{p.reference ?? "—"}</span>
                      {p.cheque && <p className="text-xs text-[var(--muted)]">{p.cheque.bank}</p>}
                      {p.proofKey && (
                        <button className="block text-xs font-bold text-[var(--accent-text)]" onClick={() => onProof(fileUrl(p.proofKey!))}>
                          View proof
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <p className="whitespace-nowrap">{when(p.collectedAt)}</p>
                      <p className="text-[var(--muted)]">{p.collectedBy?.name ?? "Retailer"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`chip ${STATE_CHIP[p.state]}`}>{STATE_LABEL[p.state]}</span>
                      {p.rejectReason && <p className="text-xs text-[var(--muted)] mt-1 max-w-40">{p.rejectReason}</p>}
                    </td>
                    <td className="px-4 py-3 min-w-44">
                      {actions(p)}
                      {rowError?.id === p.id && <p className="text-xs text-[var(--risk-text)] mt-1">{rowError.message}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: cards */}
          <div className="space-y-2.5 md:hidden">
            {payments.map((p) => (
              <div key={p.id} className="card p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold truncate">{p.retailer.outletName}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {METHOD_LABEL[p.method]} · {when(p.collectedAt)} · {p.collectedBy?.name ?? "Retailer"}
                    </p>
                  </div>
                  <p className="font-bold shrink-0">{formatINR(p.amount)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`chip ${STATE_CHIP[p.state]}`}>{STATE_LABEL[p.state]}</span>
                  {p.purpose === "WALLET" && <PurposeChip p={p.purpose} />}
                  {p.reference && <span className="chip font-mono">{p.reference}</span>}
                  {p.proofKey && (
                    <button className="chip chip-kesar" onClick={() => onProof(fileUrl(p.proofKey!))}>
                      Proof
                    </button>
                  )}
                </div>
                {p.rejectReason && <p className="text-xs text-[var(--muted)]">{p.rejectReason}</p>}
                {actions(p)}
                {rowError?.id === p.id && <p className="text-xs text-[var(--risk-text)]">{rowError.message}</p>}
              </div>
            ))}
          </div>
          {payments.length >= 500 && (
            <p className="text-xs text-[var(--muted)]">Showing the latest 500. Narrow the dates to see older ones.</p>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── Cheques ─────────────────────────────

const CHEQUE_FILTERS: { key: ChequeStatus | "" | "due"; label: string }[] = [
  { key: "", label: "To act on" },
  { key: "due", label: "Bank today" },
  { key: "RECEIVED", label: "In hand" },
  { key: "DEPOSITED", label: "Deposited" },
  { key: "CLEARED", label: "Cleared" },
  { key: "BOUNCED", label: "Bounced" },
];

function ChequesTab() {
  const params = useSearchParams();
  const [status, setStatus] = useState<ChequeStatus | "" | "due">(params.get("cheques") === "due" ? "due" : "");
  const [bankToday, setBankToday] = useState<{ count: number; amount: number } | null>(null);
  const [rows, setRows] = useState<Cheque[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bouncing, setBouncing] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [penalty, setPenalty] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await api<{ cheques: Cheque[]; bankToday?: { count: number; amount: number } }>(`/api/cheques${status ? `?status=${status}` : ""}`);
      setRows(data.cheques);
      setBankToday(data.bankToday ?? null);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Only to warn about the bounce charge; the page works without it.
    api<{ money: { chequeBouncePenalty: number } }>("/api/admin/settings")
      .then((d) => setPenalty(d.money.chequeBouncePenalty ?? 0))
      .catch(() => {});
  }, []);

  async function act(c: Cheque, action: "deposit" | "clear" | "bounce", reason?: string) {
    setBusyId(c.id);
    setRowError(null);
    try {
      await post(`/api/cheques/${c.id}`, { action, reason });
      setBouncing(null);
      await load();
    } catch (e) {
      setRowError({ id: c.id, message: errText(e) });
    } finally {
      setBusyId(null);
    }
  }

  const total = (rows ?? []).reduce((t, c) => t + c.payment.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {CHEQUE_FILTERS.map((f) => (
          <button
            key={f.key || "open"}
            onClick={() => setStatus(f.key)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
              status === f.key ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "bg-black/5 text-foreground/60"
            }`}
          >
            {f.label}
            {f.key === "due" && bankToday && bankToday.count > 0 ? ` (${bankToday.count})` : ""}
          </button>
        ))}
      </div>

      {status !== "due" && bankToday && bankToday.count > 0 && (
        <button type="button" onClick={() => setStatus("due")} className="w-full text-left rounded-2xl border border-[#e8b27a] bg-[#fff4e6] px-4 py-3 text-sm text-[#7a3d06]">
          <span className="font-bold">
            {bankToday.count} cheque{bankToday.count === 1 ? "" : "s"} can be banked today
          </span>{" "}
          · {formatINR(bankToday.amount)}. Show them
        </button>
      )}

      {error && <ErrorBox message={error} onRetry={load} />}
      {!rows && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {rows && (
        <p className="text-sm text-[var(--ink-2)]">
          {rows.length === 0 ? (
            "No cheques here."
          ) : (
            <>
              <span className="font-bold">{rows.length}</span> cheque{rows.length === 1 ? "" : "s"} · {formatINR(total)}
            </>
          )}
        </p>
      )}

      <div className="space-y-3">
        {(rows ?? []).map((c) => {
          const held = daysBetween(c.createdAt, new Date());
          const dueIn = daysBetween(new Date(), c.chequeDate);
          // A post-dated cheque's payment waits (it pays no bill) until the cheque is banked on or after its date.
          const waiting = c.payment.state === "POST_DATED";
          const active = c.payment.state === "CONFIRMED" || waiting;
          return (
            <div key={c.id} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold truncate">{c.payment.retailer.outletName}</p>
                  <p className="text-xs text-[var(--muted)]">
                    <span className="font-mono">#{c.number}</span> · {c.bank} · dated {dateOnly(c.chequeDate)}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    Received {held <= 0 ? "today" : `${held} day${held === 1 ? "" : "s"} ago`}
                    {c.payment.collectedBy && ` by ${c.payment.collectedBy.name}`} · {c.payment.number}
                  </p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="font-heading font-bold text-lg leading-none">{formatINR(c.payment.amount)}</p>
                  <span className={`chip ${CHEQUE_CHIP[c.status]}`}>{CHEQUE_LABEL[c.status]}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {c.status === "RECEIVED" && dueIn > 0 && (
                  <span className="chip chip-genda">
                    Post-dated: deposit in {dueIn} day{dueIn === 1 ? "" : "s"}
                  </span>
                )}
                {waiting && <span className="chip">Not in the dues yet</span>}
                {c.status === "RECEIVED" && held >= 3 && dueIn <= 0 && <span className="chip chip-kesar">Not deposited yet</span>}
                {c.depositedAt && c.status === "DEPOSITED" && (
                  <span className="text-xs text-[var(--muted)]">Deposited {dateOnly(c.depositedAt)}</span>
                )}
                {c.clearedAt && <span className="text-xs text-[var(--muted)]">Cleared {dateOnly(c.clearedAt)}</span>}
                {c.bouncedAt && (
                  <span className="text-xs text-[var(--muted)]">
                    Bounced {dateOnly(c.bouncedAt)}
                    {c.bounceReason && `: ${c.bounceReason}`}
                  </span>
                )}
                {!active && (c.status === "RECEIVED" || c.status === "DEPOSITED") && (
                  <span className="chip">Payment {STATE_LABEL[c.payment.state].toLowerCase()}</span>
                )}
              </div>

              {active && c.status === "RECEIVED" && !(waiting && dueIn > 0) && (
                <button className="btn btn-mor btn-sm" disabled={busyId === c.id} onClick={() => act(c, "deposit")}>
                  {busyId === c.id ? "Saving…" : "Mark deposited"}
                </button>
              )}
              {waiting && dueIn > 0 && (
                <p className="text-xs text-[var(--muted)]">
                  It can be banked from {dateOnly(c.chequeDate)}. Until then the retailer&apos;s bills stay unpaid. To hand it back, open Payments and choose Give back.
                </p>
              )}

              {active && c.status === "DEPOSITED" &&
                (bouncing === c.id ? (
                  <>
                    <ReasonForm
                      label="Why did it bounce?"
                      quick={["Insufficient funds", "Signature mismatch", "Payment stopped", "Account closed"]}
                      busy={busyId === c.id}
                      confirmText="Mark bounced"
                      onCancel={() => setBouncing(null)}
                      onSubmit={(reason) => act(c, "bounce", reason)}
                    />
                    <p className="text-xs text-[var(--muted)]">
                      The payment is undone on the retailer&apos;s account
                      {penalty > 0 && ` and a ${formatINR(penalty)} bounce charge is added`}.
                    </p>
                  </>
                ) : (
                  <div className="flex gap-2">
                    <button className="btn btn-mor btn-sm" disabled={busyId === c.id} onClick={() => act(c, "clear")}>
                      <Icon name="check" className="h-4 w-4" />
                      {busyId === c.id ? "Saving…" : "Cleared"}
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={busyId === c.id} onClick={() => setBouncing(c.id)}>
                      Bounced
                    </button>
                  </div>
                ))}
              {rowError?.id === c.id && <p className="text-sm text-[var(--risk-text)]">{rowError.message}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="card p-4 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-[var(--risk-text)]">{message}</p>
      <button className="btn btn-quiet btn-xs" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
