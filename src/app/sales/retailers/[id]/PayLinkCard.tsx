"use client";

import { useEffect, useState } from "react";
import { formatINR, toPaise } from "@/lib/money";
import Icon from "@/components/Icon";
import { PayStatusChip, createPayRequest, getPayRequest, isOpen, listPayRequests, type PayRequest } from "@/components/pay/PayKit";

/** wa.me wants the number with the country code and digits only; none = pick the chat in WhatsApp. */
function waNumber(phone: string | null) {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  return "";
}

/**
 * "Send payment link": a gateway link for the shop's dues (or an amount),
 * then Copy / Send on WhatsApp. Shown only when the business has online
 * payments set up. Sits inside the dues card of the shop screen.
 */
export default function PayLinkCard({
  retailerId,
  outletName,
  phone,
  dues,
  onPaidAction,
}: {
  retailerId: string;
  outletName: string;
  phone: string | null;
  /** The shop's dues (paise); the link is for this when no amount is typed. */
  dues: number;
  onPaidAction: () => void;
}) {
  const [on, setOn] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [link, setLink] = useState<PayRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    listPayRequests({ retailerId, take: "10" })
      .then((d) => {
        if (!live) return;
        setOn(d.on);
        // My last open link for this shop comes back on screen.
        setLink(d.requests.find((r) => r.kind === "LINK" && r.status === "CREATED" && isOpen(r) && !r.orderId) ?? null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [retailerId]);

  if (!on) return null;

  async function make() {
    setError(null);
    let paise = 0;
    try {
      paise = amount ? toPaise(amount) : 0;
    } catch {
      return setError("Enter a correct amount");
    }
    if (amount && paise <= 0) return setError("Enter a correct amount");
    setBusy(true);
    try {
      const r = await createPayRequest({ kind: "LINK", retailerId, ...(paise > 0 ? { amount: paise } : {}) });
      setLink(r);
      setOpen(false);
      setAmount("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    if (!link) return;
    setBusy(true);
    setError(null);
    try {
      const r = await getPayRequest(link.id, true);
      setLink(r);
      if (r.paidAmount > link.paidAmount) onPaidAction();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy. Press and hold the link to copy it.");
    }
  }

  const url = link?.shortUrl ?? null;
  const message = link && url ? `${outletName}: please pay ${formatINR(link.amount - link.paidAmount)} here: ${url}` : "";
  const wa = `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(message)}`;

  return (
    <div className="border-t border-black/5 pt-3 space-y-3">
      {link && url ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Payment link · {formatINR(link.amount)}</p>
            <PayStatusChip r={link} />
          </div>
          <p className="rounded-xl bg-black/[0.04] px-3 py-2 font-mono text-xs break-all select-all">{url}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline !px-3 shrink-0" onClick={() => copy(url)}>
              <Icon name={copied ? "check" : "clipboard"} className="h-4 w-4" /> {copied ? "Copied" : "Copy"}
            </button>
            <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-mor flex-1 !px-3">
              <Icon name="share" className="h-4 w-4" /> Send on WhatsApp
            </a>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button type="button" className="btn btn-quiet btn-xs" onClick={check} disabled={busy}>
              {busy ? "Checking…" : "Check if paid"}
            </button>
            <button type="button" className="btn btn-quiet btn-xs" onClick={() => { setLink(null); setOpen(true); }} disabled={busy}>
              New link
            </button>
          </div>
        </div>
      ) : open ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">Send payment link</p>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">Amount (₹), empty = all dues</span>
            <input
              className="input mt-1 font-bold"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={dues > 0 ? `All dues ${formatINR(dues, { whole: true })}` : "0"}
            />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet flex-1" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-mor flex-[2]" onClick={make} disabled={busy}>
              {busy ? "Making…" : "Make link"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-soft w-full" onClick={() => { setOpen(true); setError(null); }}>
          <Icon name="card" className="h-4 w-4" /> Send payment link
        </button>
      )}
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}
