"use client";

import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import PaymentFields, { type PaymentValue } from "@/components/PaymentFields";

/**
 * Payment at the drop: this order (after short lines), old dues, total, and
 * what is collected. The amount box follows "This order" / "Full dues" until
 * the driver types their own figure.
 */
export default function CollectCard({
  onHold,
  holdReason,
  walletPaid,
  thisOrder,
  oldDues,
  totalDue,
  overdue,
  duesLoaded,
  duesError,
  pay,
  onPayAction,
  onFollowAction,
  cashHint = "Count the cash before you mark delivered.",
}: {
  onHold: boolean;
  holdReason: string | null;
  /** Paid from the prepaid wallet for this order (paise); 0 = not prepaid. */
  walletPaid: number | null;
  thisOrder: number;
  oldDues: number;
  totalDue: number;
  overdue: number;
  duesLoaded: boolean;
  duesError: boolean;
  pay: PaymentValue;
  onPayAction: (v: PaymentValue) => void;
  onFollowAction: (target: "order" | "dues") => void;
  /** Shown under the cash amount. */
  cashHint?: string;
}) {
  const prepaid = walletPaid !== null;
  return (
    <div className="card p-4 space-y-4">
      <p className="text-sm font-semibold">Payment</p>

      {onHold && (
        <p className="rounded-xl bg-[#fde4e1] text-[#a8281e] p-3 text-sm font-semibold">
          On credit hold: {holdReason ?? "needs approval"}. Ask the office to approve before you deliver.
        </p>
      )}

      {prepaid && (
        <p className="flex items-center gap-2 rounded-xl bg-[var(--mint-tint)] text-[var(--mint-text)] p-3 text-sm font-bold">
          <Icon name="wallet" className="h-4 w-4" /> Paid from wallet {formatINR(walletPaid)}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-black/[0.04] p-2">
          <p className="text-[11px] text-[var(--muted)]">This order</p>
          <p className="font-bold text-sm mt-0.5">{formatINR(thisOrder, { whole: true })}</p>
        </div>
        <div className="rounded-xl bg-black/[0.04] p-2">
          <p className="text-[11px] text-[var(--muted)]">{oldDues < 0 ? "Advance" : "Old dues"}</p>
          <p className={`font-bold text-sm mt-0.5 ${overdue > 0 ? "text-[#a8281e]" : ""}`}>
            {duesLoaded ? formatINR(Math.abs(oldDues), { whole: true }) : duesError ? "—" : "…"}
          </p>
        </div>
        <div className="rounded-xl bg-[var(--kesar-tint)] p-2">
          <p className="text-[11px] text-[var(--kesar-text)]">Total due</p>
          <p className="font-bold text-sm mt-0.5 text-[var(--kesar-text)]">{formatINR(totalDue, { whole: true })}</p>
        </div>
      </div>
      {overdue > 0 && <p className="text-xs font-semibold text-[#a8281e]">{formatINR(overdue)} of the old dues is overdue.</p>}
      {duesError && <p className="text-xs text-[var(--muted)]">Could not load old dues.</p>}

      {(thisOrder > 0 || (duesLoaded && totalDue > 0)) && (
        <div className="flex gap-2">
          {thisOrder > 0 && (
            <button type="button" className="btn btn-soft flex-1" onClick={() => onFollowAction("order")}>
              This order
            </button>
          )}
          {duesLoaded && totalDue > 0 && totalDue !== thisOrder && (
            <button type="button" className="btn btn-soft flex-1" onClick={() => onFollowAction("dues")}>
              Full dues
            </button>
          )}
        </div>
      )}

      <PaymentFields
        value={pay}
        onChangeAction={onPayAction}
        field
        allowNone
        noneLabel={prepaid ? "Nothing now" : "On credit"}
        hint={
          !pay.method ? (
            <p className="text-sm text-[var(--muted)]">
              {prepaid && totalDue === 0 ? "Nothing to collect." : `${formatINR(totalDue)} stays on the khata.`}
            </p>
          ) : pay.method === "CASH" ? (
            <p className="text-sm text-[var(--ink-2)]">{cashHint}</p>
          ) : null
        }
      />
    </div>
  );
}
