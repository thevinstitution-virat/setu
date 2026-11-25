"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import PaymentFields, { emptyPayment, paymentError, toCollectBody, type PaymentValue } from "@/components/PaymentFields";
import { formatINR, toPaise } from "@/lib/money";
import { STATE_NAMES } from "@/components/invoice/InvoiceView";
import RetailerDeliveryCards from "@/components/admin/RetailerDeliveryCards";
import PaymentLinkCard from "@/components/admin/PaymentLinkCard";

// ───────────────────────────── types (API JSON) ─────────────────────────────

type Mode = "PREPAID" | "POSTPAID";
type Ageing = { d0_7: number; d8_15: number; d16_30: number; d30p: number };

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
  orderId: string | null;
  note: string | null;
};

type Payment = {
  id: string;
  number: string;
  purpose: "DUES" | "WALLET";
  method: "CASH" | "UPI" | "CHEQUE" | "BANK" | "ONLINE" | "WALLET" | "CREDIT_NOTE";
  state: "PENDING_VERIFICATION" | "CONFIRMED" | "REJECTED" | "REVERSED";
  amount: number;
  reference: string | null;
  note: string | null;
  rejectReason: string | null;
  collectedAt: string;
  collectedBy: { name: string; role: string } | null;
  cheque: { number: string; bank: string; chequeDate: string; status: "RECEIVED" | "DEPOSITED" | "CLEARED" | "BOUNCED"; bounceReason: string | null } | null;
};

type StatementRow = { date: string; kind: string; memo: string | null; debit: number; credit: number; balance: number };

type Khata = {
  retailer: { id: string; outletName: string; ownerName: string; phone: string | null; areaName: string; address: string };
  hasOpening: boolean;
  terms: { mode: Mode; creditLimit: number | null; creditDays: number };
  termsOverride: { paymentMode: Mode | null; creditLimit: number | null; creditDays: number | null };
  balances: { receivable: number; walletAvailable: number; walletReserved: number };
  creditAvailable: number | null;
  overdue: number;
  ageing: Ageing;
  advance: number;
  pendingVerification: { amount: number; count: number };
  openBills: Bill[];
  payments: Payment[];
  upi: { vpa: string; payee: string } | null;
  statement: { from: string; to: string; opening: number; closing: number; rows: StatementRow[] } | null;
};

// ───────────────────────────── labels & helpers ─────────────────────────────

const BILL_KIND: Record<Bill["kind"], string> = {
  ORDER: "Order bill",
  OPENING: "Opening balance",
  PENALTY: "Penalty",
  DEBIT_NOTE: "Debit note",
};

const METHOD: Record<Payment["method"], string> = {
  CASH: "Cash",
  UPI: "UPI",
  CHEQUE: "Cheque",
  BANK: "Bank",
  ONLINE: "Online",
  WALLET: "Wallet",
  CREDIT_NOTE: "Credit note",
};

const STATE: Record<Payment["state"], { label: string; cls: string }> = {
  CONFIRMED: { label: "Confirmed", cls: "chip-mint" },
  PENDING_VERIFICATION: { label: "To verify", cls: "chip-genda" },
  REJECTED: { label: "Rejected", cls: "!bg-[#fde4e1] !text-[#a8281e] !border-transparent" },
  REVERSED: { label: "Reversed", cls: "!bg-black/5 !text-[var(--muted)]" },
};

const CHEQUE: Record<NonNullable<Payment["cheque"]>["status"], { label: string; cls: string }> = {
  RECEIVED: { label: "Cheque received", cls: "chip-genda" },
  DEPOSITED: { label: "Cheque deposited", cls: "chip-kesar" },
  CLEARED: { label: "Cheque cleared", cls: "chip-mint" },
  BOUNCED: { label: "Cheque bounced", cls: "!bg-[#fde4e1] !text-[#a8281e] !border-transparent" },
};

const ENTRY_KIND: Record<string, string> = {
  SALE: "Sale",
  OPENING: "Opening balance",
  PAYMENT: "Payment",
  WALLET_RECHARGE: "Wallet recharge",
  WALLET_HOLD: "Wallet hold",
  WALLET_RELEASE: "Wallet release",
  WALLET_SETTLE: "Paid from wallet",
  CHEQUE_CLEAR: "Cheque cleared",
  CHEQUE_BOUNCE: "Cheque bounced",
  PENALTY: "Penalty",
  DEBIT_NOTE: "Debit note",
  CREDIT_NOTE: "Credit note",
  HANDOVER: "Cash handover",
  SHORTAGE_WRITEOFF: "Shortage write-off",
  REVERSAL: "Reversal",
};

const ROLE: Record<string, string> = {
  ADMIN: "Office",
  SALES_AGENT: "Sales",
  DELIVERY_AGENT: "Delivery",
  RETAILER: "Retailer",
};

const IST_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** YYYY-MM-DD for a date in IST. */
function istISO(d: Date) {
  return new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
}
function istDay(d: Date | string) {
  return Math.floor((new Date(d).getTime() + IST_MS) / DAY_MS);
}
function fmtDate(s: string | Date) {
  return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
function fmtDateTime(s: string) {
  return new Date(s).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}
function plural(n: number, w: string) {
  return `${n} ${w}${n === 1 ? "" : "s"}`;
}
/** Paise → rupee string for an input ("1250.5"). */
function toRupeeInput(p: number | null) {
  if (p === null) return "";
  return (p / 100).toFixed(2).replace(/\.00$/, "");
}
/** Safe toPaise: null when the text isn't a number. */
function parsePaise(s: string): number | null {
  if (!s.trim()) return null;
  try {
    return toPaise(s);
  } catch {
    return null;
  }
}
/** Balance with "advance" wording for negative (we owe them). */
function bal(p: number) {
  return p < 0 ? `${formatINR(-p)} adv` : formatINR(p);
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

function errText(e: unknown) {
  return e instanceof Error ? e.message : "Something went wrong";
}

function defaultRange() {
  const now = new Date();
  return { from: istISO(new Date(now.getTime() - 90 * DAY_MS)), to: istISO(now) };
}

// ───────────────────────────── page ─────────────────────────────

export default function RetailerKhataPage({ params }: { params: Promise<{ retailerId: string }> }) {
  const { retailerId } = use(params);
  const [data, setData] = useState<Khata | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState(defaultRange);
  const [rangeDraft, setRangeDraft] = useState(range);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(
    async (r: { from: string; to: string }) => {
      try {
        const res = await fetch(`/api/admin/khata/${retailerId}?from=${r.from}&to=${r.to}`);
        const d = await res.json();
        if (!res.ok) throw new Error(d.error ?? "Could not load this khata");
        setData(d);
        setLoadError(null);
      } catch (e) {
        setLoadError(errText(e));
      }
    },
    [retailerId]
  );

  useEffect(() => {
    load(range);
  }, [load, range]);

  const reload = useCallback(
    async (message?: string) => {
      await load(range);
      if (message) {
        setFlash(message);
        setTimeout(() => setFlash(null), 4000);
      }
    },
    [load, range]
  );

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        {loadError ? <p className="card p-4 text-sm text-[#a8281e]">{loadError}</p> : <p className="text-sm text-[var(--muted)]">Loading…</p>}
      </div>
    );
  }

  const { balances, terms } = data;
  const showWallet = terms.mode === "PREPAID" || balances.walletAvailable !== 0 || balances.walletReserved !== 0;
  const hasOpening = data.hasOpening;

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Print: hide the app chrome and the page background. */}
      <style>{`@media print { header, nav { display: none !important; } body { background: #fff !important; } .card { box-shadow: none !important; } }`}</style>

      <div className="print:hidden">
        <BackLink />
      </div>

      {/* Header */}
      <div className="panel-dark p-5 sm:p-6 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11.5px] font-extrabold uppercase tracking-[0.12em] text-genda">Khata</p>
            <h1 className="font-heading text-2xl sm:text-3xl font-bold mt-1 break-words">{data.retailer.outletName}</h1>
            <p className="text-sm text-white/70 mt-1">
              {[data.retailer.ownerName !== data.retailer.outletName ? data.retailer.ownerName : null, data.retailer.phone, data.retailer.areaName]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="chip !bg-white/10 !text-white !border-white/15">
                {terms.mode === "PREPAID" ? "Prepaid" : "Postpaid"}
                {data.termsOverride.paymentMode === null && " (default)"}
              </span>
              <span className="chip !bg-white/10 !text-white !border-white/15">{plural(terms.creditDays, "day")} credit</span>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs font-semibold text-white/70">{balances.receivable < 0 ? "Advance held" : "Balance due"}</p>
            <p className={`font-heading text-4xl font-bold leading-none mt-1 ${balances.receivable < 0 ? "text-mint" : ""}`}>
              {formatINR(Math.abs(balances.receivable))}
            </p>
            {data.overdue > 0 && (
              <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#fde4e1] px-2.5 py-1 text-xs font-bold text-[#a8281e]">
                <Icon name="alert" className="h-3.5 w-3.5" /> {formatINR(data.overdue)} overdue
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {showWallet && (
            <>
              <HeadStat label="Wallet available" value={formatINR(balances.walletAvailable)} />
              <HeadStat label="Wallet reserved" value={formatINR(balances.walletReserved)} hint="Held for open orders" />
            </>
          )}
          {data.advance > 0 && <HeadStat label="Unused advance" value={formatINR(data.advance)} hint="Paid ahead, not yet used by a bill" />}
          <HeadStat label="Open bills" value={String(data.openBills.length)} />
        </div>

        <CreditBar receivable={balances.receivable} limit={terms.creditLimit} available={data.creditAvailable} />
      </div>

      {data.pendingVerification.count > 0 && (
        <div className="card p-4 flex items-start gap-3 print:hidden">
          <span className="icon-tile bg-[var(--genda-tint)] text-[var(--genda-text)]">
            <Icon name="clock" />
          </span>
          <p className="text-sm text-[var(--ink-2)]">
            {plural(data.pendingVerification.count, "payment")} worth <b>{formatINR(data.pendingVerification.amount)}</b> reported by the
            retailer {data.pendingVerification.count === 1 ? "is" : "are"} waiting to be checked. {data.pendingVerification.count === 1 ? "It is" : "They are"} not in
            the balance yet.{" "}
            <Link href="/admin/payments" className="font-bold text-[var(--kesar-text)]">
              Check payments →
            </Link>
          </p>
        </div>
      )}

      {flash && (
        <p className="card p-3 text-sm font-semibold text-[var(--mint-text)] bg-[var(--mint-tint)] print:hidden" role="status">
          <Icon name="check" className="inline h-4 w-4 mr-1" />
          {flash}
        </p>
      )}
      {loadError && <p className="card p-3 text-sm text-[#a8281e] print:hidden">{loadError}</p>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="space-y-5 min-w-0">
          <div className="print:hidden">
            <OpenBills bills={data.openBills} ageing={data.ageing} />
          </div>
          <div className="print:hidden">
            <Payments payments={data.payments} onDone={reload} />
          </div>
          <Statement
            retailerId={retailerId}
            onDone={reload}
            outletName={data.retailer.outletName}
            statement={data.statement}
            draft={rangeDraft}
            setDraft={setRangeDraft}
            apply={(r) => setRange(r)}
          />
        </div>

        <div className="space-y-5 print:hidden">
          <RecordPayment retailerId={retailerId} receivable={balances.receivable} onDone={reload} />
          <PaymentLinkCard retailerId={retailerId} outletName={data.retailer.outletName} receivable={balances.receivable} onDone={reload} />
          <CreditTerms retailerId={retailerId} terms={terms} override={data.termsOverride} onDone={reload} />
          <GstDetails retailerId={retailerId} onDone={reload} />
          <RetailerDeliveryCards retailerId={retailerId} onDone={reload} />
          <Adjust retailerId={retailerId} hasOpening={hasOpening} onDone={reload} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/khata" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
      <Icon name="back" className="h-4 w-4" /> All retailers
    </Link>
  );
}

function HeadStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white/8 border border-white/10 p-3" title={hint}>
      <p className="font-heading text-lg font-bold leading-none">{value}</p>
      <p className="text-xs text-white/70 mt-1.5">{label}</p>
    </div>
  );
}

function CreditBar({ receivable, limit, available }: { receivable: number; limit: number | null; available: number | null }) {
  if (limit === null) return <p className="mt-4 text-xs text-white/70">No credit limit set.</p>;
  if (limit === 0) return <p className="mt-4 text-xs text-white/70">No credit: orders must be paid for first.</p>;
  const used = Math.max(0, receivable);
  const pct = Math.min(100, (used / limit) * 100);
  const over = used > limit;
  return (
    <div className="mt-4 space-y-1.5">
      <div className="flex justify-between gap-2 text-xs text-white/80">
        <span>
          Credit used {formatINR(used, { whole: true })} of {formatINR(limit, { whole: true })}
        </span>
        <span className={over ? "font-bold text-[#ffb4a9]" : ""}>
          {over ? `${formatINR(used - limit, { whole: true })} over limit` : `${formatINR(available ?? 0, { whole: true })} left`}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/15 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "#ff8a7a" : pct > 80 ? "var(--genda)" : "var(--mint)" }} />
      </div>
    </div>
  );
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

// ───────────────────────────── open bills ─────────────────────────────

function BillChip({ b }: { b: Bill }) {
  const today = istDay(new Date());
  if (b.overdue) {
    const d = today - istDay(b.dueDate);
    return <span className="chip !py-0.5 !px-2 !text-[11.5px] !bg-[#fde4e1] !text-[#a8281e] !border-transparent">Overdue {plural(Math.max(d, 0), "day")}</span>;
  }
  const left = istDay(b.dueDate) - today;
  return (
    <span className="chip !py-0.5 !px-2 !text-[11.5px] chip-genda">{left <= 0 ? "Due today" : `Due in ${plural(left, "day")}`}</span>
  );
}

function OpenBills({ bills, ageing }: { bills: Bill[]; ageing: Ageing }) {
  const total = bills.reduce((s, b) => s + b.due, 0);
  const today = istDay(new Date());
  return (
    <Section title="Open bills" right={bills.length > 0 && <span className="text-sm font-bold">{formatINR(total)} unpaid</span>}>
      {bills.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pt-3 text-xs text-[var(--muted)]">
          <span>0–7 days: <b className="text-[var(--ink)]">{formatINR(ageing.d0_7, { whole: true })}</b></span>
          <span>8–15: <b className="text-[var(--ink)]">{formatINR(ageing.d8_15, { whole: true })}</b></span>
          <span>16–30: <b className="text-[var(--ink)]">{formatINR(ageing.d16_30, { whole: true })}</b></span>
          <span>30+: <b className={ageing.d30p > 0 ? "text-[#a8281e]" : "text-[var(--ink)]"}>{formatINR(ageing.d30p, { whole: true })}</b></span>
        </div>
      )}
      {bills.length === 0 ? (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">No unpaid bills.</p>
      ) : (
        <>
          <table className="hidden md:table w-full text-sm mt-2">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
                <th className="px-4 py-2 font-semibold">Bill</th>
                <th className="px-2 py-2 font-semibold">Date</th>
                <th className="px-2 py-2 font-semibold">Due date</th>
                <th className="px-2 py-2 font-semibold text-right">Amount</th>
                <th className="px-2 py-2 font-semibold text-right">Unpaid</th>
                <th className="px-4 py-2 font-semibold text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {bills.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2.5">
                    <p className="font-bold">{b.number}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {BILL_KIND[b.kind]}
                      {b.note && ` · ${b.note}`}
                    </p>
                  </td>
                  <td className="px-2 py-2.5 text-[var(--ink-2)]">
                    {fmtDate(b.date)}
                    <span className="block text-xs text-[var(--muted)]">{plural(today - istDay(b.date), "day")} old</span>
                  </td>
                  <td className="px-2 py-2.5 text-[var(--ink-2)]">{fmtDate(b.dueDate)}</td>
                  <td className="px-2 py-2.5 text-right">
                    {formatINR(b.amount)}
                    {b.paid > 0 && <span className="block text-xs text-[var(--mint-text)]">{formatINR(b.paid)} paid</span>}
                  </td>
                  <td className={`px-2 py-2.5 text-right font-bold ${b.overdue ? "text-[#a8281e]" : ""}`}>{formatINR(b.due)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <BillChip b={b} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="md:hidden divide-y divide-[var(--line)] mt-2">
            {bills.map((b) => (
              <div key={b.id} className="px-4 py-3 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{b.number}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {BILL_KIND[b.kind]} · {fmtDate(b.date)}
                    </p>
                  </div>
                  <p className={`text-sm font-bold shrink-0 ${b.overdue ? "text-[#a8281e]" : ""}`}>{formatINR(b.due)}</p>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                  <span>
                    Due {fmtDate(b.dueDate)}
                    {b.paid > 0 && ` · ${formatINR(b.paid)} of ${formatINR(b.amount)} paid`}
                  </span>
                  <BillChip b={b} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

// ───────────────────────────── payments ─────────────────────────────

function canReverse(p: Payment) {
  return p.state === "CONFIRMED" && !p.cheque && p.method !== "CHEQUE" && p.method !== "WALLET";
}

function Payments({ payments, onDone }: { payments: Payment[]; onDone: (msg?: string) => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reverse(p: Payment) {
    if (reason.trim().length < 3) {
      setError("Write why this payment is being reversed");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await send(`/api/payments/${p.id}`, "POST", { action: "reverse", reason: reason.trim() });
      setOpenId(null);
      setReason("");
      await onDone(`Payment ${p.number} reversed`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Payments" right={<span className="text-xs text-[var(--muted)]">Last {payments.length >= 30 ? 30 : payments.length}</span>}>
      {payments.length === 0 ? (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">No payments yet.</p>
      ) : (
        <div className="divide-y divide-[var(--line)]">
          {payments.map((p) => {
            const st = STATE[p.state];
            const struck = p.state === "REVERSED" || p.state === "REJECTED";
            return (
              <div key={p.id} className="px-4 py-3 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {p.number}
                      {p.purpose === "WALLET" && <span className="ml-1.5 text-xs font-semibold text-[var(--mint-text)]">Wallet recharge</span>}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {fmtDateTime(p.collectedAt)} · {METHOD[p.method]}
                      {p.reference && ` · ${p.reference}`}
                      {p.collectedBy && ` · by ${p.collectedBy.name} (${ROLE[p.collectedBy.role] ?? p.collectedBy.role})`}
                    </p>
                  </div>
                  <p className={`text-sm font-bold shrink-0 ${struck ? "line-through text-[var(--muted)]" : ""}`}>{formatINR(p.amount)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${st.cls}`}>{st.label}</span>
                  {p.cheque && (
                    <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${CHEQUE[p.cheque.status].cls}`}>
                      {CHEQUE[p.cheque.status].label} · {p.cheque.number} {p.cheque.bank} · {fmtDate(p.cheque.chequeDate)}
                    </span>
                  )}
                  {canReverse(p) && openId !== p.id && (
                    <button
                      className="btn btn-quiet btn-xs ml-auto"
                      onClick={() => {
                        setOpenId(p.id);
                        setReason("");
                        setError(null);
                      }}
                    >
                      Reverse
                    </button>
                  )}
                </div>
                {(p.note || p.rejectReason || p.cheque?.bounceReason) && (
                  <p className="text-xs text-[var(--ink-2)]">
                    {p.note}
                    {p.rejectReason && <span className="block text-[#a8281e]">{p.state === "REVERSED" ? "Reversed" : "Rejected"}: {p.rejectReason}</span>}
                    {p.cheque?.bounceReason && <span className="block text-[#a8281e]">Bounced: {p.cheque.bounceReason}</span>}
                  </p>
                )}
                {openId === p.id && (
                  <div className="rounded-xl bg-[#fde4e1]/60 p-3 space-y-2">
                    <p className="text-xs font-semibold text-[#a8281e]">
                      Reverse {formatINR(p.amount)}? It goes back on the retailer&apos;s balance. This can&apos;t be undone.
                    </p>
                    <input
                      className="input"
                      placeholder="Reason, e.g. entered twice"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      autoFocus
                    />
                    {error && <p className="text-xs text-[#a8281e]">{error}</p>}
                    <div className="flex gap-2">
                      <button className="btn btn-danger btn-xs" disabled={busy} onClick={() => reverse(p)}>
                        {busy ? "Reversing…" : "Reverse payment"}
                      </button>
                      <button className="btn btn-quiet btn-xs" disabled={busy} onClick={() => setOpenId(null)}>
                        Keep it
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ───────────────────────────── statement ─────────────────────────────

/** Send the shop its balance and khata link now (in the app, and WhatsApp / SMS per settings). */
function SendStatement({ retailerId, outletName, onDone }: { retailerId: string; outletName: string; onDone: (msg?: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (!window.confirm(`Send ${outletName} their balance and a link to their khata now? It goes in the app, and on WhatsApp or SMS if those are on in Settings.`)) return;
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/khata/${retailerId}/statement`, "POST", {});
      await onDone(`Statement sent to ${outletName}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn btn-outline btn-xs" onClick={go} disabled={busy}>
        <Icon name="share" className="h-4 w-4" /> {busy ? "Sending…" : "Send statement"}
      </button>
      {error && (
        <p className="basis-full text-xs text-[#a8281e]" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

type Range = { from: string; to: string };

function Statement({
  retailerId,
  onDone,
  outletName,
  statement,
  draft,
  setDraft,
  apply,
}: {
  retailerId: string;
  onDone: (msg?: string) => Promise<void>;
  outletName: string;
  statement: Khata["statement"];
  draft: Range;
  setDraft: (r: Range) => void;
  apply: (r: Range) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  function go(r: Range) {
    if (!r.from || !r.to) return setError("Pick both dates");
    if (r.from > r.to) return setError("The start date is after the end date");
    if ((Date.parse(r.to) - Date.parse(r.from)) / DAY_MS > 400) return setError("Pick 400 days or less");
    setError(null);
    setDraft(r);
    apply(r);
  }

  function preset(days: number | "fy") {
    const now = new Date();
    const to = istISO(now);
    let from: string;
    if (days === "fy") {
      const [y, m] = to.split("-").map(Number);
      from = `${m >= 4 ? y : y - 1}-04-01`;
    } else from = istISO(new Date(now.getTime() - days * DAY_MS));
    go({ from, to });
  }

  const rows = statement?.rows ?? [];
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <section className="card overflow-hidden print:shadow-none print:border-0">
      <div className="hidden print:block px-4 pt-4">
        <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Statement of account</p>
        <h1 className="font-heading text-xl font-bold">{outletName}</h1>
        {statement && (
          <p className="text-sm text-[var(--ink-2)]">
            {fmtDate(statement.from)} to {fmtDate(statement.to)} · printed {fmtDate(new Date())}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--line)] print:hidden">
        <h2 className="font-heading font-bold">Statement</h2>
        <div className="flex flex-wrap gap-2">
          <SendStatement retailerId={retailerId} outletName={outletName} onDone={onDone} />
          <button className="btn btn-outline btn-xs" onClick={() => window.print()} disabled={!statement}>
            <Icon name="receipt" className="h-4 w-4" /> Print
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-2 border-b border-[var(--line)] print:hidden">
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">From</span>
            <input className="input mt-1 !w-[150px]" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">To</span>
            <input className="input mt-1 !w-[150px]" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </label>
          <button className="btn btn-mor btn-sm" onClick={() => go(draft)}>
            Show
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button className="btn btn-quiet btn-xs" onClick={() => preset(30)}>
            30 days
          </button>
          <button className="btn btn-quiet btn-xs" onClick={() => preset(90)}>
            90 days
          </button>
          <button className="btn btn-quiet btn-xs" onClick={() => preset("fy")}>
            This financial year
          </button>
        </div>
        {error && <p className="text-xs text-[#a8281e]">{error}</p>}
      </div>

      {!statement ? (
        <p className="px-4 py-5 text-sm text-[var(--muted)]">No statement for this range.</p>
      ) : (
        <>
          <div className="flex justify-between gap-2 px-4 py-2.5 text-sm bg-black/[0.03] print:bg-transparent">
            <span className="text-[var(--muted)]">Opening balance · {fmtDate(statement.from)}</span>
            <b>{bal(statement.opening)}</b>
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-5 text-sm text-[var(--muted)]">No entries in this range.</p>
          ) : (
            <>
              <table className="hidden md:table print:table w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)] border-b border-[var(--line)]">
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-2 py-2 font-semibold">Details</th>
                    <th className="px-2 py-2 font-semibold text-right">Debit</th>
                    <th className="px-2 py-2 font-semibold text-right">Credit</th>
                    <th className="px-4 py-2 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {rows.map((r, i) => (
                    <tr key={i} className="break-inside-avoid">
                      <td className="px-4 py-2 whitespace-nowrap text-[var(--ink-2)]">{fmtDate(r.date)}</td>
                      <td className="px-2 py-2">
                        <span className="font-semibold">{ENTRY_KIND[r.kind] ?? r.kind}</span>
                        {r.memo && <span className="block text-xs text-[var(--muted)]">{r.memo}</span>}
                      </td>
                      <td className="px-2 py-2 text-right">{r.debit ? formatINR(r.debit) : ""}</td>
                      <td className="px-2 py-2 text-right text-[var(--mint-text)]">{r.credit ? formatINR(r.credit) : ""}</td>
                      <td className="px-4 py-2 text-right font-semibold whitespace-nowrap">{bal(r.balance)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--line)] text-xs font-bold">
                    <td className="px-4 py-2" colSpan={2}>
                      Total
                    </td>
                    <td className="px-2 py-2 text-right">{formatINR(totalDebit)}</td>
                    <td className="px-2 py-2 text-right">{formatINR(totalCredit)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
              <div className="md:hidden print:hidden divide-y divide-[var(--line)]">
                {rows.map((r, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{ENTRY_KIND[r.kind] ?? r.kind}</p>
                      <p className="text-xs text-[var(--muted)] break-words">
                        {fmtDate(r.date)}
                        {r.memo && ` · ${r.memo}`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${r.credit ? "text-[var(--mint-text)]" : ""}`}>
                        {r.debit ? `+${formatINR(r.debit)}` : `−${formatINR(r.credit)}`}
                      </p>
                      <p className="text-xs text-[var(--muted)]">Bal {bal(r.balance)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex justify-between gap-2 px-4 py-2.5 text-sm bg-black/[0.03] border-t border-[var(--line)] print:bg-transparent">
            <span className="text-[var(--muted)]">Closing balance · {fmtDate(statement.to)}</span>
            <b className={statement.closing < 0 ? "text-[var(--mint-text)]" : ""}>{bal(statement.closing)}</b>
          </div>
          <p className="px-4 pb-3 pt-1 text-[11px] text-[var(--muted)]">Debit = owes us more. Credit = paid or reduced. &quot;adv&quot; = paid in advance.</p>
        </>
      )}
    </section>
  );
}

// ───────────────────────────── record payment ─────────────────────────────

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-2xl p-1 bg-ink/5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`flex-1 rounded-xl py-1.5 text-xs font-bold transition ${
            value === o.key ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "text-[var(--ink-2)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RecordPayment({ retailerId, receivable, onDone }: { retailerId: string; receivable: number; onDone: (msg?: string) => Promise<void> }) {
  const [purpose, setPurpose] = useState<"DUES" | "WALLET">("DUES");
  const [value, setValue] = useState<PaymentValue>(() => emptyPayment());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const err = paymentError(value);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      const collect = await toCollectBody(value);
      if (!collect) throw new Error("Pick a payment method");
      const { payment } = await send("/api/payments", "POST", { retailerId, ...collect, purpose, note: note.trim() || undefined });
      setValue(emptyPayment(undefined, value.method));
      setNote("");
      await onDone(`${payment?.number ?? "Payment"} recorded: ${formatINR(collect.amount)}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Record payment">
      <div className="p-4 space-y-3">
        <Toggle
          value={purpose}
          onChange={setPurpose}
          options={[
            { key: "DUES", label: "Pay dues" },
            { key: "WALLET", label: "Wallet recharge" },
          ]}
        />
        <PaymentFields
          value={value}
          onChangeAction={setValue}
          methods={["CASH", "UPI", "CHEQUE", "BANK"]}
          hint={
            purpose === "DUES" && receivable > 0 ? (
              <p className="text-xs text-[var(--muted)]">
                Due now {formatINR(receivable)}.{" "}
                <button
                  type="button"
                  className="font-bold text-[var(--kesar-text)]"
                  onClick={() => setValue({ ...value, amount: toRupeeInput(receivable) })}
                >
                  Fill full amount
                </button>
              </p>
            ) : purpose === "WALLET" ? (
              <p className="text-xs text-[var(--muted)]">Goes into the wallet and is used for future orders.</p>
            ) : null
          }
        />
        <label className="block">
          <span className="text-xs font-semibold text-[var(--ink-2)]">Note (optional)</span>
          <input className="input mt-1" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="text-xs text-[#a8281e]">{error}</p>}
        <button className="btn btn-kesar btn-sm w-full" disabled={busy || !value.method} onClick={submit}>
          <Icon name="cash" className="h-4 w-4" />
          {busy ? "Saving…" : purpose === "WALLET" ? "Add to wallet" : "Record payment"}
        </button>
      </div>
    </Section>
  );
}

// ───────────────────────────── credit terms ─────────────────────────────

function CreditTerms({
  retailerId,
  terms,
  override,
  onDone,
}: {
  retailerId: string;
  terms: Khata["terms"];
  override: Khata["termsOverride"];
  onDone: (msg?: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"DEFAULT" | Mode>(override.paymentMode ?? "DEFAULT");
  const [limit, setLimit] = useState(toRupeeInput(override.creditLimit));
  const [days, setDays] = useState(override.creditDays === null ? "" : String(override.creditDays));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the form in step with the server after a reload.
  const key = `${override.paymentMode}|${override.creditLimit}|${override.creditDays}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setMode(override.paymentMode ?? "DEFAULT");
    setLimit(toRupeeInput(override.creditLimit));
    setDays(override.creditDays === null ? "" : String(override.creditDays));
  }

  async function save() {
    let creditLimit: number | null = null;
    if (limit.trim()) {
      const p = parsePaise(limit);
      if (p === null || p < 0) return setError("Credit limit must be ₹0 or more");
      creditLimit = p;
    }
    let creditDays: number | null = null;
    if (days.trim()) {
      const n = Number(days);
      if (!Number.isInteger(n) || n < 0 || n > 365) return setError("Credit days must be 0 to 365");
      creditDays = n;
    }
    setBusy(true);
    setError(null);
    try {
      await send(`/api/admin/khata/${retailerId}`, "PATCH", { paymentMode: mode === "DEFAULT" ? null : mode, creditLimit, creditDays });
      await onDone("Credit terms saved");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const defaultTag = (isDefault: boolean) => (isDefault ? <span className="text-[var(--muted)] font-normal"> (default)</span> : null);

  return (
    <Section title="Credit terms">
      <div className="p-4 space-y-3">
        <div className="rounded-xl bg-black/[0.03] p-3 text-xs text-[var(--ink-2)] space-y-0.5">
          <p className="font-semibold text-[var(--muted)]">In use now</p>
          <p>
            <b>{terms.mode === "PREPAID" ? "Prepaid" : "Postpaid"}</b>
            {defaultTag(override.paymentMode === null)}
          </p>
          <p>
            Limit: <b>{terms.creditLimit === null ? "No limit" : terms.creditLimit === 0 ? "No credit" : formatINR(terms.creditLimit, { whole: true })}</b>
            {defaultTag(override.creditLimit === null)}
          </p>
          <p>
            Pay within: <b>{plural(terms.creditDays, "day")}</b>
            {defaultTag(override.creditDays === null)}
          </p>
        </div>

        <div>
          <span className="text-xs font-semibold text-[var(--ink-2)]">Payment mode</span>
          <div className="mt-1">
            <Toggle
              value={mode}
              onChange={setMode}
              options={[
                { key: "DEFAULT", label: "Default" },
                { key: "PREPAID", label: "Prepaid" },
                { key: "POSTPAID", label: "Postpaid" },
              ]}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">Credit limit (₹)</span>
            <input
              className="input mt-1"
              inputMode="decimal"
              placeholder="Default"
              value={limit}
              onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">Credit days</span>
            <input
              className="input mt-1"
              inputMode="numeric"
              placeholder="Default"
              value={days}
              onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        </div>
        <p className="text-[11px] text-[var(--muted)]">Leave blank to use the business default. A limit of 0 means no credit.</p>
        {error && <p className="text-xs text-[#a8281e]">{error}</p>}
        <button className="btn btn-mor btn-sm w-full" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save terms"}
        </button>
      </div>
    </Section>
  );
}

// ───────────────────────────── GST details ─────────────────────────────

type GstInfo = { gstin: string | null; legalName: string | null; stateCode: string | null };
const STATE_OPTIONS = Object.entries(STATE_NAMES).sort((a, b) => a[1].localeCompare(b[1]));

function GstDetails({ retailerId, onDone }: { retailerId: string; onDone: (msg?: string) => Promise<void> }) {
  const [saved, setSaved] = useState<GstInfo | null>(null);
  const [gstin, setGstin] = useState("");
  const [legalName, setLegalName] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fill = useCallback((r: GstInfo) => {
    setSaved(r);
    setGstin(r.gstin ?? "");
    setLegalName(r.legalName ?? "");
    setStateCode(r.stateCode ?? "");
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/retailers/${retailerId}/gst`)
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error ?? "Could not load GST details");
        if (live) fill(d.retailer);
      })
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [retailerId, fill]);

  const code = gstin.slice(0, 2);
  const gstinState = gstin.length >= 2 && STATE_NAMES[code] ? code : null;
  const dirty = !!saved && (gstin !== (saved.gstin ?? "") || legalName.trim() !== (saved.legalName ?? "") || stateCode !== (saved.stateCode ?? ""));

  async function save() {
    if (gstin && gstin.length !== 15) return setError("A GSTIN has 15 characters");
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string | null> = { gstin: gstin || null, legalName: legalName.trim() || null };
      if (!gstin) body.stateCode = stateCode || null;
      const d = await send(`/api/admin/retailers/${retailerId}/gst`, "PATCH", body);
      fill(d.retailer);
      await onDone("GST details saved");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="GST details">
      <div className="p-4 space-y-3">
        {!saved && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {saved && (
          <>
            <p className="text-xs text-[var(--ink-2)]">
              {saved.gstin ? "Registered: gets tax invoices with their GSTIN." : "No GSTIN: bills show them as unregistered."}
            </p>
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">GSTIN</span>
              <input
                className="input mt-1 uppercase"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="Not registered"
                value={gstin}
                onChange={(e) => {
                  const g = e.target.value.replace(/\s/g, "").toUpperCase().slice(0, 15);
                  setGstin(g);
                  const c = g.slice(0, 2);
                  if (g.length >= 2 && STATE_NAMES[c]) setStateCode(c);
                  setError(null);
                }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">Legal name</span>
              <input
                className="input mt-1"
                maxLength={100}
                placeholder="As on their GST certificate"
                value={legalName}
                onChange={(e) => {
                  setLegalName(e.target.value);
                  setError(null);
                }}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">State</span>
              <select
                className="input mt-1"
                value={gstinState ?? stateCode}
                disabled={!!gstinState}
                onChange={(e) => {
                  setStateCode(e.target.value);
                  setError(null);
                }}
              >
                <option value="">Same as yours</option>
                {STATE_OPTIONS.map(([c, name]) => (
                  <option key={c} value={c}>
                    {name} ({c})
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-[var(--muted)]">
              A GSTIN sets the state by itself. Invoices already issued keep the old details; new ones use these.
            </p>
            {error && <p className="text-xs text-[#a8281e]">{error}</p>}
            <button className="btn btn-mor btn-sm w-full" disabled={busy || !dirty} onClick={save}>
              {busy ? "Saving…" : "Save GST details"}
            </button>
          </>
        )}
        {!saved && error && <p className="text-xs text-[#a8281e]">{error}</p>}
      </div>
    </Section>
  );
}

// ───────────────────────────── adjustments ─────────────────────────────

type AdjustAction = "debit_note" | "credit_note" | "penalty" | "opening";

const ADJUST: Record<AdjustAction, { label: string; help: string; button: string }> = {
  debit_note: { label: "Debit note", help: "Adds to what the retailer owes (e.g. a missed charge).", button: "Add debit note" },
  credit_note: { label: "Credit note", help: "Reduces what the retailer owes (discount, return, goodwill).", button: "Add credit note" },
  penalty: { label: "Penalty", help: "A late-payment or bounce charge. Adds to what they owe.", button: "Add penalty" },
  opening: { label: "Opening", help: "Balance carried over from before this app. Only one per retailer.", button: "Save opening balance" },
};

function Adjust({ retailerId, hasOpening, onDone }: { retailerId: string; hasOpening: boolean; onDone: (msg?: string) => Promise<void> }) {
  const [action, setAction] = useState<AdjustAction>("debit_note");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [owes, setOwes] = useState<"OWES" | "ADVANCE">("OWES");
  const [asOf, setAsOf] = useState(() => istISO(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const p = parsePaise(amount);
    if (p === null || p <= 0) return setError("Enter the amount");
    if (action !== "opening" && note.trim().length < 3) return setError("Write what this is for");
    const signed = action === "opening" && owes === "ADVANCE" ? -p : p;
    const what =
      action === "opening"
        ? `opening balance of ${formatINR(p)} (${owes === "ADVANCE" ? "advance" : "owes us"}) as of ${fmtDate(asOf)}`
        : `${ADJUST[action].label.toLowerCase()} of ${formatINR(p)}`;
    if (!window.confirm(`Add ${what}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await send("/api/admin/ledger", "POST", {
        action,
        retailerId,
        amount: signed,
        note: note.trim(),
        ...(action === "opening" ? { asOf } : {}),
      });
      setAmount("");
      setNote("");
      await onDone(`${ADJUST[action].label} saved: ${formatINR(p)}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Adjust">
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.keys(ADJUST) as AdjustAction[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setAction(a);
                setError(null);
              }}
              className={`rounded-xl py-2 text-xs font-bold ${
                action === a ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/70"
              }`}
            >
              {ADJUST[a].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--muted)]">{ADJUST[action].help}</p>
        {action === "opening" && hasOpening && (
          <p className="text-xs font-semibold text-[var(--genda-text)] bg-[var(--genda-tint)] rounded-lg px-2.5 py-1.5">
            This retailer already seems to have an opening balance.
          </p>
        )}

        {action === "opening" && (
          <Toggle
            value={owes}
            onChange={setOwes}
            options={[
              { key: "OWES", label: "Retailer owes us" },
              { key: "ADVANCE", label: "We hold advance" },
            ]}
          />
        )}
        <div className={action === "opening" ? "grid grid-cols-2 gap-2" : ""}>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">Amount (₹)</span>
            <input
              className="input mt-1"
              inputMode="decimal"
              placeholder="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </label>
          {action === "opening" && (
            <label className="block">
              <span className="text-xs font-semibold text-[var(--ink-2)]">As of</span>
              <input className="input mt-1" type="date" max={istISO(new Date())} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </label>
          )}
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-[var(--ink-2)]">Note{action === "opening" ? " (optional)" : ""}</span>
          <input
            className="input mt-1"
            maxLength={300}
            value={note}
            placeholder={action === "credit_note" ? "e.g. 2 cartons returned" : action === "penalty" ? "e.g. Late payment, March" : ""}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && <p className="text-xs text-[#a8281e]">{error}</p>}
        <button className="btn btn-outline btn-sm w-full" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : ADJUST[action].button}
        </button>
      </div>
    </Section>
  );
}
