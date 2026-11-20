"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { api, errText, readRupees, send } from "@/components/admin/AdminKit";

/**
 * Khata (admin) card for one shop: make an online payment link (Razorpay or
 * the test simulator), share it on WhatsApp, and see recent requests.
 */

type Status = "CREATED" | "PARTIAL" | "PAID" | "EXPIRED" | "CANCELLED";

type PayRequest = {
  id: string;
  kind: "LINK" | "QR";
  provider: string;
  retailerId: string;
  outletName: string | null;
  purpose: "DUES" | "WALLET";
  amount: number;
  paidAmount: number;
  orderId: string | null;
  shortUrl: string | null;
  imageUrl: string | null;
  status: Status;
  error: string | null;
  note: string | null;
  expiresAt: string | null;
  createdAt: string;
};

type ListData = { on: boolean; provider: string; retailerPay: boolean; requests: PayRequest[] };

const STATUS: Record<Status, { label: string; cls: string }> = {
  CREATED: { label: "Waiting", cls: "chip-genda" },
  PARTIAL: { label: "Part paid", cls: "chip-kesar" },
  PAID: { label: "Paid", cls: "chip-mint" },
  EXPIRED: { label: "Expired", cls: "!bg-black/5 !text-[var(--muted)]" },
  CANCELLED: { label: "Cancelled", cls: "!bg-black/5 !text-[var(--muted)]" },
};

const isOpen = (r: PayRequest) => r.status === "CREATED" || r.status === "PARTIAL";

function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function waLink(r: PayRequest, outletName: string) {
  const due = r.amount - r.paidAmount;
  const text = `Namaste ${r.outletName ?? outletName}, please pay ${formatINR(due)} using this link: ${r.shortUrl}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export default function PaymentLinkCard({
  retailerId,
  outletName,
  receivable,
  onDone,
}: {
  retailerId: string;
  outletName: string;
  receivable: number;
  onDone: (msg?: string) => Promise<void>;
}) {
  const [data, setData] = useState<ListData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<PayRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowMsg, setRowMsg] = useState<{ id: string; text: string; bad?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<ListData>(`/api/pay-requests?retailerId=${encodeURIComponent(retailerId)}&take=10`));
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    }
  }, [retailerId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    const p = readRupees(amount);
    if (p === "bad") return setError("Enter the amount in rupees, e.g. 1500");
    if (p !== null && p < 100) return setError("The amount must be at least ₹1");
    setBusy(true);
    setError(null);
    try {
      const r = await send<PayRequest>("/api/pay-requests", "POST", {
        retailerId,
        kind: "LINK",
        ...(p !== null ? { amount: p } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setLatest(r);
      setAmount("");
      setNote("");
      await load();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(r: PayRequest, action: "sync" | "cancel") {
    if (action === "cancel" && !window.confirm(`Cancel the ${formatINR(r.amount)} payment link? The shop can no longer pay with it.`)) return;
    setBusyId(r.id);
    setRowMsg(null);
    try {
      const res = await send<PayRequest & { recorded?: number }>(`/api/pay-requests/${r.id}`, "POST", { action });
      if (latest?.id === r.id) setLatest(res);
      if (action === "sync" && res.recorded) {
        await load();
        await onDone(`Online payment recorded: ${formatINR(res.paidAmount)} paid of ${formatINR(res.amount)}`);
      } else {
        await load();
        setRowMsg({ id: r.id, text: action === "cancel" ? "Link cancelled" : isOpen(res) ? "Not paid yet" : `Now: ${STATUS[res.status].label}` });
      }
    } catch (e) {
      setRowMsg({ id: r.id, text: errText(e), bad: true });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">Payment link</h2>
        {data?.on && data.provider === "simulator" && <span className="chip !py-0.5 !px-2 !text-[11.5px] chip-genda">Test mode</span>}
      </div>
      <div className="p-4 space-y-3">
        {loadError && (
          <p className="text-xs text-[#a8281e]">
            {loadError}{" "}
            <button type="button" className="font-bold underline" onClick={load}>
              Try again
            </button>
          </p>
        )}
        {!data && !loadError && <p className="text-sm text-[var(--muted)]">Loading…</p>}

        {data && !data.on && (
          <p className="text-sm text-[var(--ink-2)]">
            Online payments are off —{" "}
            <Link href="/admin/settings" className="font-bold text-[var(--kesar-text)]">
              set them up in Settings
            </Link>
            .
          </p>
        )}

        {data?.on && (
          <>
            <p className="text-xs text-[var(--muted)]">Send the shop a link to pay online. The payment is added to their khata by itself.</p>
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">Amount (₹)</span>
              <input
                className="input mt-1"
                inputMode="decimal"
                placeholder={receivable > 0 ? `All dues (${formatINR(receivable)})` : "Amount"}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ""))}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">Note (optional)</span>
              <input className="input mt-1" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {receivable <= 0 && !amount.trim() && <p className="text-[11px] text-[var(--muted)]">Nothing is due now, so enter an amount.</p>}
            {error && <p className="text-xs text-[#a8281e]">{error}</p>}
            <button className="btn btn-kesar btn-sm w-full" disabled={busy} onClick={create}>
              <Icon name="share" className="h-4 w-4" />
              {busy ? "Making link…" : "Make payment link"}
            </button>

            {latest && <LinkBox r={latest} outletName={outletName} />}
          </>
        )}

        {data && data.requests.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-xs font-bold text-[var(--ink-2)]">Recent requests</p>
            <div className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)]">
              {data.requests.map((r) => (
                <div key={r.id} className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">
                        {formatINR(r.amount)}
                        {r.purpose === "WALLET" && <span className="ml-1.5 text-xs font-semibold text-[var(--mint-text)]">Wallet</span>}
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {r.kind === "QR" ? "QR" : "Link"} · {fmtDateTime(r.createdAt)}
                        {isOpen(r) && r.expiresAt && ` · ends ${fmtDateTime(r.expiresAt)}`}
                      </p>
                    </div>
                    <span className={`chip !py-0.5 !px-2 !text-[11.5px] shrink-0 ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                  </div>
                  {r.paidAmount > 0 && (
                    <p className="text-xs text-[var(--mint-text)]">
                      {formatINR(r.paidAmount)} paid of {formatINR(r.amount)}
                    </p>
                  )}
                  {r.note && <p className="text-xs text-[var(--ink-2)] break-words">{r.note}</p>}
                  {r.error && <p className="text-xs text-[#a8281e] break-words">{r.error}</p>}
                  {isOpen(r) && (
                    <div className="flex flex-wrap gap-1.5">
                      {r.shortUrl && <CopyButton text={r.shortUrl} small />}
                      <button className="btn btn-quiet btn-xs" disabled={busyId === r.id} onClick={() => act(r, "sync")}>
                        {busyId === r.id ? "Checking…" : "Check now"}
                      </button>
                      {r.status === "CREATED" && (
                        <button className="btn btn-quiet btn-xs" disabled={busyId === r.id} onClick={() => act(r, "cancel")}>
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                  {rowMsg?.id === r.id && <p className={`text-xs ${rowMsg.bad ? "text-[#a8281e]" : "text-[var(--muted)]"}`}>{rowMsg.text}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function LinkBox({ r, outletName }: { r: PayRequest; outletName: string }) {
  if (!r.shortUrl) {
    return (
      <p className="rounded-xl bg-[#fde4e1]/60 p-3 text-xs text-[#a8281e]">
        {r.error ?? "The link could not be made. Try again in a minute."}
      </p>
    );
  }
  return (
    <div className="rounded-xl bg-[var(--mint-tint)] p-3 space-y-2">
      <p className="text-xs font-semibold text-[var(--mint-text)]">Link ready for {formatINR(r.amount - r.paidAmount)}</p>
      <p className="text-xs font-mono break-all select-all bg-white rounded-lg px-2 py-1.5">{r.shortUrl}</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={r.shortUrl} />
        <a className="btn btn-mor btn-xs" href={waLink(r, outletName)} target="_blank" rel="noreferrer">
          <Icon name="chat" className="h-4 w-4" /> Send on WhatsApp
        </a>
      </div>
    </div>
  );
}

function CopyButton({ text, small }: { text: string; small?: boolean }) {
  const [done, setDone] = useState<"ok" | "fail" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone("ok");
    } catch {
      setDone("fail");
    }
    setTimeout(() => setDone(null), 2000);
  }

  return (
    <button type="button" className={`btn btn-xs ${small ? "btn-quiet" : "btn-outline"}`} onClick={copy}>
      {!small && <Icon name="file" className="h-4 w-4" />}
      {done === "ok" ? "Copied" : done === "fail" ? "Copy failed" : small ? "Copy link" : "Copy"}
    </button>
  );
}
