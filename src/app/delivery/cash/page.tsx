"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";

type CashMe = {
  cashInHand: number;
  carriedForward: number;
  today: {
    id: string;
    number: string;
    method: string;
    purpose: "DUES" | "WALLET";
    state: "CONFIRMED" | "REVERSED";
    amount: number;
    reference: string | null;
    collectedAt: string;
    retailer: { outletName: string };
    cheque: { number: string; bank: string; status: string } | null;
  }[];
  todayByMethod: Record<string, number>;
  lastHandover: { expected: number; counted: number; variance: number; note: string | null; createdAt: string } | null;
};

const METHOD: Record<string, string> = { CASH: "Cash", UPI: "UPI", CHEQUE: "Cheque", BANK: "Bank" };
const time = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

export default function MyCashPage() {
  const [data, setData] = useState<CashMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch("/api/cash/me");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not load your cash");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load your cash");
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (!data) {
    return error ? (
      <div className="card p-5 space-y-3">
        <p className="text-sm text-[var(--risk-text)]">{error}</p>
        <button className="btn btn-quiet btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    ) : (
      <p className="text-sm text-foreground/50">Loading…</p>
    );
  }

  const methods = (["CASH", "UPI", "CHEQUE", "BANK"] as const).filter((m) => (data.todayByMethod[m] ?? 0) > 0);
  const todayTotal = Object.values(data.todayByMethod).reduce((s, v) => s + v, 0);
  const h = data.lastHandover;

  return (
    <div className="space-y-5">
      <div>
        <p className="page-kick">Money</p>
        <h1 className="page-title">My cash</h1>
      </div>

      <div className="panel-dark p-5 space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Cash in hand</p>
          <p className="stat-num !text-4xl mt-2">{formatINR(data.cashInHand)}</p>
          <p className="text-sm text-white/70 mt-2">Give this to the office.</p>
        </div>
        {data.carriedForward > 0 && (
          <div className="border-t border-white/10 pt-3 flex justify-between text-sm">
            <span className="text-white/70">From earlier days</span>
            <span className="font-bold">{formatINR(data.carriedForward)}</span>
          </div>
        )}
      </div>

      <section className="space-y-2">
        <h2 className="font-bold text-base">Collected today</h2>
        {methods.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--muted)]">Nothing collected yet today.</div>
        ) : (
          <div className="card divide-y divide-black/5">
            {methods.map((m) => (
              <div key={m} className="px-4 py-3 flex justify-between text-sm">
                <span className="text-[var(--ink-2)]">{METHOD[m]}</span>
                <span className="font-bold">{formatINR(data.todayByMethod[m])}</span>
              </div>
            ))}
            <div className="px-4 py-3 flex justify-between text-sm bg-black/[0.03]">
              <span className="font-semibold">Total</span>
              <span className="font-bold">{formatINR(todayTotal)}</span>
            </div>
          </div>
        )}
        {(data.todayByMethod.UPI ?? 0) + (data.todayByMethod.CHEQUE ?? 0) + (data.todayByMethod.BANK ?? 0) > 0 && (
          <p className="text-xs text-[var(--muted)]">Only cash is in your hand. Give cheques to the office too.</p>
        )}
      </section>

      {data.today.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold text-base">Today&apos;s collections</h2>
          <div className="card divide-y divide-black/5">
            {data.today.map((p) => {
              const reversed = p.state === "REVERSED";
              return (
                <div key={p.id} className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{p.retailer.outletName}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {METHOD[p.method] ?? p.method} · {time(p.collectedAt)}
                      {p.purpose === "WALLET" ? " · wallet" : ""}
                    </p>
                    {p.cheque && (
                      <p className="text-xs text-[var(--muted)]">
                        Cheque {p.cheque.number}, {p.cheque.bank}
                      </p>
                    )}
                    {p.method === "UPI" && p.reference && <p className="text-xs text-[var(--muted)]">UTR {p.reference}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold ${reversed ? "line-through text-[var(--muted)]" : ""}`}>{formatINR(p.amount)}</p>
                    {reversed && <span className="chip mt-1">Reversed</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-bold text-base">Last handover</h2>
        {h ? (
          <div className="card p-4 space-y-2 text-sm">
            <p className="text-xs text-[var(--muted)] flex items-center gap-1.5">
              <Icon name="clock" className="h-4 w-4" />
              {new Date(h.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
            </p>
            <div className="flex justify-between">
              <span className="text-[var(--ink-2)]">Should have</span>
              <span className="font-bold">{formatINR(h.expected)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--ink-2)]">Counted</span>
              <span className="font-bold">{formatINR(h.counted)}</span>
            </div>
            {h.variance > 0 ? (
              <div className="flex justify-between text-[var(--risk-text)]">
                <span className="font-semibold">Short</span>
                <span className="font-bold">{formatINR(h.variance)}</span>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-[var(--success-text)] font-semibold">
                <Icon name="check" className="h-4 w-4" /> Matched
              </p>
            )}
            {h.note && <p className="text-xs text-[var(--muted)]">{h.note}</p>}
          </div>
        ) : (
          <div className="card p-4 text-sm text-[var(--muted)]">No handover yet.</div>
        )}
      </section>
    </div>
  );
}
