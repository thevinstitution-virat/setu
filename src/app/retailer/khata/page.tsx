"use client";

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { formatINR, toPaise } from "@/lib/money";
import { upiLink } from "@/lib/money-settings";
import { compressImage, uploadFile } from "@/lib/upload-client";
import Icon from "@/components/Icon";

type Bill = {
  id: string;
  number: string;
  kind: "ORDER" | "OPENING" | "PENALTY" | "DEBIT_NOTE";
  date: string;
  dueDate: string;
  amount: number;
  paid: number;
  due: number;
  overdue: boolean;
  note: string | null;
};

type Payment = {
  id: string;
  number: string;
  purpose: "DUES" | "WALLET";
  method: string;
  state: "PENDING_VERIFICATION" | "CONFIRMED" | "REJECTED" | "REVERSED";
  amount: number;
  reference: string | null;
  collectedAt: string;
  rejectReason: string | null;
  cheque: { number: string; bank: string; status: "RECEIVED" | "DEPOSITED" | "CLEARED" | "BOUNCED"; bounceReason: string | null } | null;
  collectedBy: { name: string; role: string } | null;
};

type Khata = {
  retailer: { id: string; outletName: string };
  terms: { mode: "PREPAID" | "POSTPAID"; creditLimit: number | null; creditDays: number };
  balances: { receivable: number; walletAvailable: number; walletReserved: number };
  creditAvailable: number | null;
  overdue: number;
  advance: number;
  pendingVerification: { amount: number; count: number };
  openBills: Bill[];
  payments: Payment[];
  upi: { vpa: string; payee: string } | null;
  statement: {
    opening: number;
    closing: number;
    rows: { date: string; kind: string; memo: string | null; debit: number; credit: number; balance: number }[];
  } | null;
};

const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const shortDate = (s: string) => new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const daysSince = (s: string) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000));
/** Receivable-style balance: positive = you owe, negative = advance. */
const bal = (p: number) => (p >= 0 ? formatINR(p) : `${formatINR(-p)} adv.`);

const BILL_KIND: Record<Bill["kind"], string> = {
  ORDER: "Order",
  OPENING: "Old balance",
  PENALTY: "Penalty",
  DEBIT_NOTE: "Extra charge",
};

const METHOD: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CHEQUE: "Cheque",
  BANK: "Bank",
  WALLET: "Wallet",
  CREDIT_NOTE: "Credit note",
};

const ENTRY: Record<string, string> = {
  SALE: "Order delivered",
  OPENING: "Old balance",
  PAYMENT: "Payment",
  WALLET_SETTLE: "Paid from wallet",
  CHEQUE_BOUNCE: "Cheque bounced",
  PENALTY: "Penalty",
  DEBIT_NOTE: "Extra charge",
  CREDIT_NOTE: "Credit note",
  REVERSAL: "Correction",
};

function PaymentChip({ p }: { p: Payment }) {
  if (p.cheque?.status === "BOUNCED") return <span className="chip bg-[#fde4e1] text-[#a8281e] border-transparent">Cheque bounced</span>;
  if (p.state === "PENDING_VERIFICATION") return <span className="chip chip-genda">Waiting</span>;
  if (p.state === "REJECTED") return <span className="chip bg-[#fde4e1] text-[#a8281e] border-transparent">Rejected</span>;
  if (p.state === "REVERSED") return <span className="chip">Reversed</span>;
  if (p.cheque && p.cheque.status !== "CLEARED") return <span className="chip chip-kesar">Cheque in bank</span>;
  return <span className="chip chip-mint">Confirmed</span>;
}

export default function KhataPage() {
  const [from, setFrom] = useState(() => istToday().slice(0, 8) + "01");
  const [to, setTo] = useState(istToday);
  const [data, setData] = useState<Khata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/khata?from=${from}&to=${to}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not load your khata");
      setData(d);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load your khata");
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return loadError ? (
      <div className="card p-5 space-y-3">
        <p className="text-sm text-[#a8281e]">{loadError}</p>
        <button className="btn btn-quiet btn-sm" onClick={load}>
          Try again
        </button>
      </div>
    ) : (
      <p className="text-sm text-foreground/50">Loading…</p>
    );
  }

  const { terms, balances } = data;
  const prepaid = terms.mode === "PREPAID";
  const owes = balances.receivable;
  const creditUsed = Math.max(0, owes);
  const usedPct = terms.creditLimit ? Math.min(100, Math.round((creditUsed / terms.creditLimit) * 100)) : 0;

  return (
    <div className="space-y-5">
      {/* The app header and bottom bar are not part of a printed statement. */}
      <style>{`@media print { header, nav { display: none !important; } main { padding: 0 !important; } }`}</style>

      <div className="print:hidden">
        <p className="page-kick">Money</p>
        <h1 className="page-title">My khata</h1>
        <p className="page-sub">
          {prepaid ? "Prepaid: orders are paid from your wallet." : `Pay each bill within ${terms.creditDays} days.`}
        </p>
      </div>

      {/* ── Balance ── */}
      <div className="panel-dark p-5 space-y-4 print:hidden">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">
            {owes > 0 ? "You owe" : owes < 0 ? "Advance with us" : "Your dues"}
          </p>
          <p className="stat-num !text-4xl mt-2">{owes === 0 ? "All paid" : formatINR(Math.abs(owes))}</p>
          {data.overdue > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#fde4e1] text-[#a8281e] px-3 py-1 text-sm font-bold">
              <Icon name="alert" className="h-4 w-4" /> {formatINR(data.overdue)} overdue
            </p>
          )}
        </div>

        {prepaid ? (
          <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
            <div>
              <p className="text-xs text-white/60">Wallet balance</p>
              <p className="font-heading font-bold text-xl mt-1">{formatINR(balances.walletAvailable)}</p>
            </div>
            <div>
              <p className="text-xs text-white/60">Kept for open orders</p>
              <p className="font-heading font-bold text-xl mt-1">{formatINR(balances.walletReserved)}</p>
            </div>
          </div>
        ) : terms.creditLimit !== null ? (
          <div className="border-t border-white/10 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-white/70">Credit used</span>
              <span className="font-bold">
                {formatINR(creditUsed, { whole: true })} of {formatINR(terms.creditLimit, { whole: true })}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/15 overflow-hidden">
              <div
                className={`h-full rounded-full ${usedPct >= 90 ? "bg-[#f26b5b]" : "bg-[var(--kesar)]"}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="text-sm text-white/80">
              You can still order for <b>{formatINR(data.creditAvailable ?? 0, { whole: true })}</b>
            </p>
          </div>
        ) : null}

        {data.pendingVerification.amount > 0 && (
          <p className="flex items-center gap-2 text-sm text-genda">
            <Icon name="clock" className="h-4 w-4" />
            {formatINR(data.pendingVerification.amount)} waiting for confirmation
          </p>
        )}

        {!paying && (
          <button className="btn btn-kesar w-full !min-h-[52px] text-base" onClick={() => { setPaying(true); setThanks(null); }}>
            <Icon name="wallet" /> Pay now
          </button>
        )}
      </div>

      {thanks && (
        <div className="card p-4 flex items-start gap-3 print:hidden">
          <span className="icon-tile bg-[var(--mint-tint)] text-[var(--mint-text)]">
            <Icon name="check" />
          </span>
          <p className="text-sm text-[var(--ink-2)] pt-2">{thanks}</p>
        </div>
      )}

      {paying && (
        <PayPanel
          data={data}
          onCancelAction={() => setPaying(false)}
          onDoneAction={async (msg) => {
            setPaying(false);
            setThanks(msg);
            await load();
          }}
        />
      )}

      {/* ── Open bills ── */}
      <section className="space-y-2 print:hidden">
        <h2 className="font-bold text-base">Bills to pay</h2>
        {data.openBills.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--muted)]">No unpaid bills.</div>
        ) : (
          <div className="card divide-y divide-black/5">
            {data.openBills.map((b) => (
              <div key={b.id} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm truncate">{b.number}</p>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {BILL_KIND[b.kind]} · {shortDate(b.date)} · {daysSince(b.date)} days old
                  </p>
                  {b.paid > 0 && (
                    <p className="text-xs text-[var(--muted)]">
                      Bill {formatINR(b.amount)} · paid {formatINR(b.paid)}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className={`font-bold ${b.overdue ? "text-[#a8281e]" : ""}`}>{formatINR(b.due)}</p>
                  {b.overdue ? (
                    <span className="chip bg-[#fde4e1] text-[#a8281e] border-transparent mt-1">
                      Overdue {daysSince(b.dueDate)}d
                    </span>
                  ) : (
                    <p className="text-xs text-[var(--muted)] mt-1">Due {shortDate(b.dueDate)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Recent payments ── */}
      <section className="space-y-2 print:hidden">
        <h2 className="font-bold text-base">Recent payments</h2>
        {data.payments.length === 0 ? (
          <div className="card p-4 text-sm text-[var(--muted)]">No payments yet.</div>
        ) : (
          <div className="card divide-y divide-black/5">
            {data.payments.map((p) => (
              <div key={p.id} className="p-4 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{formatINR(p.amount)}</p>
                    <p className="text-xs text-[var(--muted)] mt-0.5">
                      {METHOD[p.method] ?? p.method}
                      {p.purpose === "WALLET" ? " · to wallet" : ""} · {shortDate(p.collectedAt)}
                      {p.collectedBy ? ` · to ${p.collectedBy.name}` : ""}
                    </p>
                    {p.cheque && (
                      <p className="text-xs text-[var(--muted)]">
                        Cheque {p.cheque.number}, {p.cheque.bank}
                      </p>
                    )}
                  </div>
                  <PaymentChip p={p} />
                </div>
                {p.state === "REJECTED" && p.rejectReason && (
                  <p className="text-xs text-[#a8281e]">Reason: {p.rejectReason}</p>
                )}
                {p.cheque?.status === "BOUNCED" && p.cheque.bounceReason && (
                  <p className="text-xs text-[#a8281e]">Reason: {p.cheque.bounceReason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Statement ── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-bold text-base">Statement</h2>
          <button className="btn btn-quiet btn-sm print:hidden" onClick={() => window.print()}>
            <Icon name="receipt" className="h-4 w-4" /> Print
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 print:hidden">
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">From</span>
            <input className="input mt-1" type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">To</span>
            <input className="input mt-1" type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </label>
        </div>
        {loadError && <p className="text-sm text-[#a8281e] print:hidden">{loadError}</p>}

        <div className="hidden print:block">
          <p className="font-bold text-lg">{data.retailer.outletName}: statement</p>
          <p className="text-sm">
            {shortDate(from)} {from.slice(0, 4)} to {shortDate(to)} {to.slice(0, 4)}
          </p>
        </div>

        {data.statement && (
          <div className="card divide-y divide-black/5 print:shadow-none print:border-black/20">
            <div className="p-3 flex justify-between text-sm bg-black/[0.03]">
              <span className="font-semibold">Opening balance</span>
              <span className="font-bold">{bal(data.statement.opening)}</span>
            </div>
            {data.statement.rows.map((r, i) => (
              <div key={i} className="p-3 flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{r.memo || ENTRY[r.kind] || r.kind}</p>
                  <p className="text-xs text-[var(--muted)]">{shortDate(r.date)}</p>
                </div>
                <div className="text-right shrink-0">
                  {r.debit > 0 && <p className="font-semibold">+ {formatINR(r.debit)}</p>}
                  {r.credit > 0 && <p className="font-semibold text-[var(--mint-text)]">− {formatINR(r.credit)}</p>}
                  <p className="text-xs text-[var(--muted)]">Bal. {bal(r.balance)}</p>
                </div>
              </div>
            ))}
            {data.statement.rows.length === 0 && (
              <p className="p-3 text-sm text-[var(--muted)]">Nothing in these dates.</p>
            )}
            <div className="p-3 flex justify-between text-sm bg-black/[0.03]">
              <span className="font-semibold">Closing balance</span>
              <span className="font-bold">{bal(data.statement.closing)}</span>
            </div>
          </div>
        )}
        <p className="text-xs text-[var(--muted)]">+ is a bill, − is a payment. &quot;adv.&quot; means money paid in advance.</p>
      </section>
    </div>
  );
}

function PayPanel({
  data,
  onCancelAction,
  onDoneAction,
}: {
  data: Khata;
  onCancelAction: () => void;
  onDoneAction: (message: string) => void | Promise<void>;
}) {
  const prepaid = data.terms.mode === "PREPAID";
  // Dues already reported but not yet confirmed shouldn't be asked for twice.
  const pendingDues = data.payments
    .filter((p) => p.state === "PENDING_VERIFICATION" && p.purpose === "DUES")
    .reduce((s, p) => s + p.amount, 0);
  const duesLeft = Math.max(0, data.balances.receivable - pendingDues);
  const rupees = (p: number) => (p > 0 ? (p / 100).toFixed(2).replace(/\.00$/, "") : "");

  const [purpose, setPurpose] = useState<"DUES" | "WALLET">(prepaid && duesLeft === 0 ? "WALLET" : "DUES");
  const [amount, setAmount] = useState(() => (purpose === "DUES" ? rupees(duesLeft) : ""));
  const [method, setMethod] = useState<"UPI" | "BANK">(data.upi ? "UPI" : "BANK");
  const [utr, setUtr] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [qr, setQr] = useState<{ link: string; img: string } | null>(null);

  let paise = 0;
  try {
    paise = amount ? toPaise(amount) : 0;
  } catch {
    paise = 0;
  }

  const link =
    data.upi && method === "UPI" && paise > 0
      ? upiLink(data.upi.vpa, data.upi.payee, paise, `${purpose === "WALLET" ? "Wallet" : "Dues"} ${data.retailer.outletName}`)
      : null;

  useEffect(() => {
    if (!link) return;
    let live = true;
    QRCode.toDataURL(link, { margin: 1, width: 240 }).then((img) => live && setQr({ link, img }));
    return () => {
      live = false;
    };
  }, [link]);

  function choosePurpose(p: "DUES" | "WALLET") {
    setPurpose(p);
    setAmount(p === "DUES" ? rupees(duesLeft) : "");
  }

  async function submit() {
    setError(null);
    if (paise <= 0) return setError("Enter the amount you paid");
    const ref = utr.trim();
    if (!/^[A-Za-z0-9]{6,30}$/.test(ref)) {
      return setError(method === "UPI" ? "Enter the 12-digit UTR number from your UPI app" : "Enter the bank reference number");
    }
    setSaving(true);
    try {
      const proofKey = proof ? await uploadFile(await compressImage(proof), "payment-proof") : undefined;
      const res = await fetch("/api/payments/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: paise, method, reference: ref, proofKey, purpose }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Could not send");
      await onDoneAction(`Thank you. We will check ${formatINR(paise)} and confirm it soon.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const tab = (on: boolean) =>
    `flex-1 rounded-xl py-3 text-sm font-semibold ${on ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/70"}`;

  return (
    <div className="card p-4 space-y-4 print:hidden">
      <div className="flex items-center justify-between">
        <p className="font-bold">Pay now</p>
        <button className="btn btn-quiet btn-xs" onClick={onCancelAction}>
          Close
        </button>
      </div>

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
          placeholder="0"
        />
      </label>
      <div className="flex gap-2 flex-wrap">
        {purpose === "DUES" ? (
          <>
            {duesLeft > 0 && (
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setAmount(rupees(duesLeft))}>
                All dues {formatINR(duesLeft, { whole: true })}
              </button>
            )}
            {data.overdue > 0 && data.overdue < duesLeft && (
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setAmount(rupees(data.overdue))}>
                Overdue {formatINR(data.overdue, { whole: true })}
              </button>
            )}
          </>
        ) : (
          [100000, 200000, 500000].map((p) => (
            <button key={p} type="button" className="btn btn-soft btn-sm" onClick={() => setAmount(rupees(p))}>
              {formatINR(p, { whole: true })}
            </button>
          ))
        )}
      </div>
      {pendingDues > 0 && purpose === "DUES" && (
        <p className="text-xs text-[var(--muted)]">{formatINR(pendingDues)} you already sent is waiting for confirmation and is not asked again.</p>
      )}

      <div className="flex gap-2" role="radiogroup" aria-label="How you paid">
        <button type="button" role="radio" aria-checked={method === "UPI"} className={tab(method === "UPI")} onClick={() => setMethod("UPI")}>
          UPI
        </button>
        <button type="button" role="radio" aria-checked={method === "BANK"} className={tab(method === "BANK")} onClick={() => setMethod("BANK")}>
          Bank transfer
        </button>
      </div>

      {method === "UPI" &&
        (data.upi ? (
          <div className="rounded-2xl bg-black/[0.03] p-4 space-y-3 text-center">
            <p className="text-sm text-[var(--ink-2)]">
              Pay to <b>{data.upi.payee || data.upi.vpa}</b>
              <br />
              <span className="font-mono text-xs select-all">{data.upi.vpa}</span>
            </p>
            {link ? (
              <>
                {qr?.link === link ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr.img} alt="UPI QR code" width={240} height={240} className="mx-auto rounded-xl bg-white p-2" />
                ) : (
                  <div className="mx-auto h-[240px] w-[240px] rounded-xl bg-white" />
                )}
                <p className="text-xs text-[var(--muted)]">Scan with any UPI app, or on this phone tap below.</p>
                <a href={link} className="btn btn-mor w-full !min-h-[52px]">
                  <Icon name="qr" /> Pay {formatINR(paise)} with UPI app
                </a>
              </>
            ) : (
              <p className="text-sm text-[var(--muted)]">Enter the amount to see the QR code.</p>
            )}
          </div>
        ) : (
          <p className="rounded-2xl bg-[var(--genda-tint)] text-[var(--genda-text)] p-3 text-sm">
            UPI payment is not set up yet by the business. You can still pay by bank transfer and tell us here.
          </p>
        ))}

      <div className="space-y-3 border-t border-black/5 pt-4">
        <p className="text-sm font-semibold">After you pay, tell us here</p>
        <label className="block">
          <span className="text-xs font-semibold text-[var(--ink-2)]">
            {method === "UPI" ? "UTR number (12 digits, in your UPI app)" : "Bank reference number"}
          </span>
          <input
            className="input mt-1"
            value={utr}
            onChange={(e) => setUtr(e.target.value.replace(/\s/g, ""))}
            placeholder={method === "UPI" ? "e.g. 431234567890" : ""}
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-[var(--ink-2)]">Screenshot of payment (optional)</span>
          <input type="file" accept="image/*" className="block text-sm mt-1" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
        </label>
        {error && <p className="text-sm text-[#a8281e]">{error}</p>}
        <button className="btn btn-kesar w-full !min-h-[52px] text-base" onClick={submit} disabled={saving}>
          {saving ? "Sending…" : `I have paid${paise > 0 ? ` ${formatINR(paise)}` : ""}`}
        </button>
      </div>
    </div>
  );
}
