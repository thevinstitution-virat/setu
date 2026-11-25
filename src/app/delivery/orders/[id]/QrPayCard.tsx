"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import {
  cancelPayRequest,
  createPayRequest,
  getPayRequest,
  isExpired,
  isOpen,
  leftOf,
  listPayRequests,
  timeOf,
  type PayRequest,
} from "@/components/pay/PayKit";

/** What has come in online for this order so far. */
export type OnlinePaid = { paid: number; full: boolean };

const POLL_MS = 4_000;

/** List updater: replace the request with the same id, or put it first. */
const withRequest = (r: PayRequest) => (rs: PayRequest[] | null) => {
  const all = rs ?? [];
  return all.some((x) => x.id === r.id) ? all.map((x) => (x.id === r.id ? r : x)) : [r, ...all];
};

/**
 * "Shop pays by QR": a single-use UPI QR for this order from the payment
 * gateway. Polls while the QR is open; reports what was paid so the screen
 * can drop (or shrink) the collection. Shown only when the business has a
 * gateway, or when the order already has an online request.
 */
export default function QrPayCard({
  orderId,
  retailerId,
  amount,
  askAmount,
  canMake,
  onChangeAction,
}: {
  orderId: string;
  retailerId: string;
  /** What is left to collect for this order (paise), as the screen shows it. */
  amount: number;
  /** Send `amount` to the server (short lines, wallet); else the server takes what is left on the order. */
  askAmount: boolean;
  /** Nothing stops a new QR (not on hold, trip running, something to collect). */
  canMake: boolean;
  onChangeAction: (v: OnlinePaid) => void;
}) {
  const [on, setOn] = useState(false);
  const [requests, setRequests] = useState<PayRequest[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [img, setImg] = useState<{ url: string; src: string } | null>(null);

  useEffect(() => {
    let live = true;
    listPayRequests({ orderId })
      .then((d) => {
        if (!live) return;
        setOn(d.on);
        setRequests(d.requests);
      })
      .catch(() => live && setRequests([]));
    return () => {
      live = false;
    };
  }, [orderId]);

  const list = requests ?? [];
  const paid = list.reduce((s, r) => s + r.paidAmount, 0);
  const full = list.some((r) => r.status === "PAID");
  // The newest open QR is the one on show.
  const current = list.find((r) => r.kind === "QR" && isOpen(r)) ?? null;
  const currentId = current?.id ?? null;
  const qrText = current && !current.imageUrl ? current.shortUrl : null;

  useEffect(() => {
    onChangeAction({ paid, full });
  }, [paid, full, onChangeAction]);

  // Ask about the open QR every few seconds while it is on screen.
  useEffect(() => {
    if (!currentId) return;
    let live = true;
    const t = setInterval(() => {
      getPayRequest(currentId, true)
        .then((r) => live && setRequests(withRequest(r)))
        .catch(() => {
          // A missed check is fine: the next one follows.
        });
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [currentId]);

  // Practice gateway: no QR image from it, so draw one from the link.
  useEffect(() => {
    if (!qrText) return;
    let live = true;
    QRCode.toDataURL(qrText, { margin: 1, width: 240 }).then((src) => live && setImg({ url: qrText, src }));
    return () => {
      live = false;
    };
  }, [qrText]);

  const upsert = (r: PayRequest) => setRequests(withRequest(r));

  async function make() {
    setBusy(true);
    setError(null);
    try {
      upsert(await createPayRequest({ kind: "QR", retailerId, orderId, ...(askAmount && amount > 0 ? { amount } : {}) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    setError(null);
    try {
      upsert(await cancelPayRequest(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      // It may have been paid in the meantime: look again.
      getPayRequest(id, true).then(upsert).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  if (requests === null) return null;
  if (!on && list.length === 0) return null;

  if (full) {
    return (
      <div className="card p-4 space-y-2">
        <p className="flex items-center gap-2 rounded-xl bg-[var(--success-tint)] text-[var(--success-text)] p-3 text-sm font-bold">
          <Icon name="check" className="h-4 w-4" /> Paid {formatINR(paid)} online
        </p>
        <p className="text-sm text-[var(--muted)]">Nothing to collect for this order. Mark it delivered.</p>
      </div>
    );
  }

  // The last QR that closed without full payment (to say why it went away).
  const last = list.find((r) => r.kind === "QR");
  const lastClosed = !current && last && (last.status === "CANCELLED" || last.status === "EXPIRED" || isExpired(last)) ? last : null;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span className="icon-tile bg-[var(--accent-tint)] text-[var(--accent-text)]">
          <Icon name="qr" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Shop pays by QR</p>
          <p className="text-xs text-[var(--muted)]">Any UPI app. It shows here when paid.</p>
        </div>
      </div>

      {paid > 0 && (
        <p className="rounded-xl bg-[var(--success-tint)] text-[var(--success-text)] p-3 text-sm font-bold">
          Paid so far {formatINR(paid)} online. Collect the rest below.
        </p>
      )}

      {current ? (
        <div className="rounded-2xl bg-black/[0.03] p-4 space-y-3 text-center">
          <p className="text-sm text-[var(--ink-2)]">
            Scan to pay <b>{formatINR(leftOf(current))}</b>
          </p>
          {current.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current.imageUrl} alt="QR code to pay" width={240} className="mx-auto rounded-xl bg-white p-2 max-w-full h-auto" />
          ) : img && img.url === qrText ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img.src} alt="QR code to pay" width={240} height={240} className="mx-auto rounded-xl bg-white p-2" />
          ) : (
            <div className="mx-auto h-[240px] w-[240px] max-w-full rounded-xl bg-white" />
          )}
          <p className="flex items-center justify-center gap-1.5 text-xs text-[var(--muted)]">
            <Icon name="clock" className="h-3.5 w-3.5" /> Waiting for payment · open till {timeOf(current.expiresAt)}
          </p>
          {qrText && (
            <a href={qrText} target="_blank" rel="noopener noreferrer" className="block text-xs font-semibold text-[var(--accent-text)] underline break-all">
              Practice link: {qrText}
            </a>
          )}
          {current.status === "CREATED" && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => cancel(current.id)} disabled={busy}>
              {busy ? "Please wait…" : "Cancel QR"}
            </button>
          )}
        </div>
      ) : canMake ? (
        <>
          {lastClosed && (
            <p className="text-xs text-[var(--muted)]">
              The last QR {lastClosed.status === "CANCELLED" ? "was cancelled" : "expired"}. Make a new one if the shop wants to pay this way.
            </p>
          )}
          <button type="button" className="btn btn-mor w-full" onClick={make} disabled={busy}>
            <Icon name="qr" className="h-4 w-4" /> {busy ? "Making QR…" : `Show QR for ${formatINR(amount)}`}
          </button>
        </>
      ) : null}

      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}
