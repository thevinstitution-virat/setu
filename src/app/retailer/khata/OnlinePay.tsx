"use client";

import { useState } from "react";
import { formatINR, toPaise } from "@/lib/money";
import Icon from "@/components/Icon";
import { PayStatusChip, createPayRequest, dayOf, isOpen, type PayRequest } from "@/components/pay/PayKit";

const rupees = (p: number) => (p > 0 ? (p / 100).toFixed(2).replace(/\.00$/, "") : "");

/**
 * Pay online through the business's payment gateway (card / UPI / net banking).
 * Makes a payment link for the shop and opens it; the gateway sends the shop
 * back to /retailer/khata?paid=1.
 */
export function OnlinePayPanel({
  dues,
  prepaid,
  onCancelAction,
}: {
  /** All dues (paise); the amount box starts with this. */
  dues: number;
  prepaid: boolean;
  onCancelAction: () => void;
}) {
  const [purpose, setPurpose] = useState<"DUES" | "WALLET">(prepaid && dues <= 0 ? "WALLET" : "DUES");
  const [amount, setAmount] = useState(() => (purpose === "DUES" ? rupees(dues) : ""));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  let paise = 0;
  let bad = false;
  try {
    paise = amount ? toPaise(amount) : 0;
  } catch {
    bad = true;
  }

  function choosePurpose(p: "DUES" | "WALLET") {
    setPurpose(p);
    setAmount(p === "DUES" ? rupees(dues) : "");
    setError(null);
  }

  async function go() {
    setError(null);
    if (bad || (amount && paise <= 0)) return setError("Enter a correct amount");
    if (purpose === "WALLET" && paise <= 0) return setError("Enter how much to add to the wallet");
    setBusy(true);
    try {
      const r = await createPayRequest({ kind: "LINK", purpose, ...(paise > 0 ? { amount: paise } : {}) });
      if (!r.shortUrl) throw new Error("The payment page did not open. Try again.");
      window.location.assign(r.shortUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  const tab = (on: boolean) =>
    `flex-1 rounded-xl py-3 text-sm font-semibold ${on ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "bg-black/5 text-foreground/70"}`;

  return (
    <div className="card p-4 space-y-4 print:hidden">
      <div className="flex items-center justify-between">
        <p className="font-bold">Pay online</p>
        <button className="btn btn-quiet btn-xs" onClick={onCancelAction} disabled={busy}>
          Close
        </button>
      </div>
      <p className="text-sm text-[var(--muted)]">Card, UPI or net banking. It is added to your khata by itself.</p>

      {prepaid && (
        <div className="flex gap-2" role="radiogroup" aria-label="What is this payment for">
          <button type="button" role="radio" aria-checked={purpose === "DUES"} className={tab(purpose === "DUES")} onClick={() => choosePurpose("DUES")}>
            Pay dues
          </button>
          <button type="button" role="radio" aria-checked={purpose === "WALLET"} className={tab(purpose === "WALLET")} onClick={() => choosePurpose("WALLET")}>
            Add to wallet
          </button>
        </div>
      )}

      <label className="block">
        <span className="text-xs font-semibold text-[var(--ink-2)]">Amount (₹)</span>
        <input
          className="input mt-1 !text-lg font-bold"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder={purpose === "DUES" ? "All dues" : "0"}
        />
      </label>
      {purpose === "DUES" && dues > 0 && rupees(dues) !== amount && (
        <button type="button" className="btn btn-soft btn-sm" onClick={() => setAmount(rupees(dues))}>
          All dues {formatINR(dues, { whole: true })}
        </button>
      )}

      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
      <button className="btn btn-kesar w-full !min-h-[52px] text-base" onClick={go} disabled={busy}>
        <Icon name="card" />
        {busy ? "Opening…" : paise > 0 ? `Pay ${formatINR(paise)} online` : "Pay all dues online"}
      </button>
    </div>
  );
}

/** The shop's last few online payment requests (links it made, QRs shown by the driver). */
export function OnlineRequests({ requests }: { requests: PayRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <section className="space-y-2 print:hidden">
      <h2 className="font-bold text-base">Online payments</h2>
      <div className="card divide-y divide-black/5">
        {requests.map((r) => (
          <div key={r.id} className="p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold">{formatINR(r.amount)}</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                {r.kind === "QR" ? "QR at delivery" : r.purpose === "WALLET" ? "To wallet" : "Dues"} · {dayOf(r.createdAt)}
                {r.status === "PARTIAL" ? ` · paid ${formatINR(r.paidAmount)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {r.kind === "LINK" && r.status === "CREATED" && isOpen(r) && r.shortUrl && (
                <a href={r.shortUrl} className="btn btn-soft btn-xs">
                  Open
                </a>
              )}
              <PayStatusChip r={r} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
