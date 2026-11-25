"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";

type SimRequest = {
  id: string;
  business: string;
  outletName: string;
  amount: number;
  paidAmount: number;
  status: "CREATED" | "PARTIAL" | "PAID" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
  kind: "LINK" | "QR";
};

const longTime = (s: string) =>
  new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const past = (s: string) => new Date(s).getTime() <= Date.now();

/** The practice gateway's pay screen: one big button, then "Paid". */
export default function SimPay({ id }: { id: string }) {
  const [req, setReq] = useState<SimRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paidNow, setPaidNow] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/pay/sim/${id}`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Payment request not found");
      setReq(d as SimRequest);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Payment request not found");
    }
  }, [id]);

  useEffect(() => {
    let live = true;
    fetch(`/api/pay/sim/${id}`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "Payment request not found");
        if (live) setReq(d as SimRequest);
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : "Payment request not found"));
    return () => {
      live = false;
    };
  }, [id]);

  async function pay() {
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/sim/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error ?? "Payment failed");
      setPaidNow(req.amount - req.paidAmount);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  }

  const banner = (
    <p className="flex items-center gap-2 rounded-xl bg-[var(--scheme-tint)] text-[var(--scheme-text)] p-3 text-sm font-bold">
      <Icon name="alert" className="h-4 w-4 shrink-0" /> Practice payment — no real money moves
    </p>
  );

  if (!req) {
    return (
      <div className="space-y-4">
        {banner}
        {loadError ? (
          <div className="card p-5 space-y-3">
            <p className="text-sm text-[var(--risk-text)]">{loadError}</p>
            <button className="btn btn-quiet btn-sm" onClick={load}>
              Try again
            </button>
          </div>
        ) : (
          <p className="text-sm text-foreground/50">Loading…</p>
        )}
      </div>
    );
  }

  const left = Math.max(0, req.amount - req.paidAmount);
  const expired = req.status === "EXPIRED" || ((req.status === "CREATED" || req.status === "PARTIAL") && past(req.expiresAt));
  const open = (req.status === "CREATED" || req.status === "PARTIAL") && !expired && left > 0;

  return (
    <div className="space-y-4">
      {banner}

      <div className="panel-dark p-5 space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">{req.business}</p>
          <p className="text-sm text-white/70 mt-1">Payment from {req.outletName}</p>
        </div>
        <div>
          <p className="text-xs text-white/60">{req.paidAmount > 0 && open ? "Still to pay" : "Amount"}</p>
          <p className="stat-num !text-4xl mt-1">{formatINR(open ? left : req.amount)}</p>
          {req.paidAmount > 0 && open && <p className="text-sm text-white/70 mt-1">Paid so far {formatINR(req.paidAmount)}</p>}
        </div>
        {open && <p className="text-xs text-white/60">Open till {longTime(req.expiresAt)}</p>}
      </div>

      {req.status === "PAID" ? (
        <div className="card p-5 space-y-4 text-center">
          <span className="icon-tile mx-auto bg-[var(--success-tint)] text-[var(--success-text)]">
            <Icon name="check" />
          </span>
          <div>
            <p className="font-heading font-bold text-xl">Paid</p>
            <p className="text-sm text-[var(--muted)] mt-1">
              {formatINR(paidNow ?? req.amount)} paid to {req.business}.
            </p>
          </div>
          <Link href="/retailer/khata?paid=1" className="btn btn-mor w-full">
            Back to my khata
          </Link>
        </div>
      ) : open ? (
        <div className="space-y-3">
          {paidNow !== null && (
            <p className="rounded-xl bg-[var(--success-tint)] text-[var(--success-text)] p-3 text-sm font-bold">{formatINR(paidNow)} paid.</p>
          )}
          {error && (
            <p role="alert" className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-semibold">
              {error}
            </p>
          )}
          <button className="btn btn-kesar w-full !min-h-[60px] text-lg" onClick={pay} disabled={busy}>
            <Icon name="rupee" /> {busy ? "Paying…" : `Pay ${formatINR(left)}`}
          </button>
          <p className="text-xs text-center text-[var(--muted)]">This is a test page. Tapping pays at once.</p>
        </div>
      ) : (
        <div className="card p-5 space-y-3 text-center">
          <p className="font-heading font-bold text-lg">{req.status === "CANCELLED" ? "This request was cancelled" : "This request has expired"}</p>
          <p className="text-sm text-[var(--muted)]">Nothing to pay here. Ask for a new link or QR.</p>
          <Link href="/retailer/khata" className="btn btn-outline w-full">
            Go to my khata
          </Link>
        </div>
      )}
    </div>
  );
}
