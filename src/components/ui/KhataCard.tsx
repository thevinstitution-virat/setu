import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";

/**
 * The retailer's khata in the money (blue) tone. The due figure turns
 * risk-coloured when something is overdue. Presentational: the page passes
 * the numbers it already reads from khataSummary.
 */
export default function KhataCard({
  href = "/retailer/khata",
  owes,
  overdue,
  prepaid,
  walletAvailable,
  pendingVerification,
  className = "",
}: {
  href?: string;
  /** Receivable in paise: positive = the shop owes, negative = advance. */
  owes: number;
  overdue: number;
  prepaid: boolean;
  walletAvailable: number;
  pendingVerification?: number;
  className?: string;
}) {
  const label = prepaid ? "Wallet balance" : owes > 0 ? "Khata due" : owes < 0 ? "Advance with us" : "My khata";
  const figure = prepaid ? formatINR(walletAvailable, { whole: true }) : owes === 0 ? "All paid" : formatINR(Math.abs(owes), { whole: true });
  const late = overdue > 0;
  return (
    <Link href={href} className={`block rounded-[var(--r-xl)] bg-[var(--money)] text-white p-4 transition hover:-translate-y-0.5 ${className}`}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold opacity-85">{label}</span>
        <Icon name={prepaid ? "wallet" : "book"} className="h-[18px] w-[18px] opacity-85" weight="duotone" />
      </span>
      <span className="block font-heading font-bold text-[26px] leading-tight mt-1 num">{figure}</span>
      {late ? (
        <span className="inline-block mt-1 text-[12px] font-bold rounded-full bg-[var(--risk-tint)] text-[var(--risk-text)] px-2 py-0.5">{formatINR(overdue, { whole: true })} overdue</span>
      ) : prepaid && owes > 0 ? (
        <span className="block text-[12px] opacity-85 mt-1">Dues {formatINR(owes, { whole: true })}</span>
      ) : pendingVerification && pendingVerification > 0 ? (
        <span className="block text-[12px] opacity-85 mt-1">{formatINR(pendingVerification, { whole: true })} waiting for confirmation</span>
      ) : null}
      <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-bold text-[var(--genda)]">
        {owes > 0 || prepaid ? "Pay now" : "Open"} <Icon name="arrow" className="h-3.5 w-3.5" weight="bold" />
      </span>
    </Link>
  );
}
