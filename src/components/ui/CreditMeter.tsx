import { formatINR } from "@/lib/money";
import { Icon3D } from "@/components/icons3d/Icon3D";

/**
 * Credit used against the limit. The bar turns scheme-coloured above 80% and
 * risk-coloured at or above 100%. Needs the limit and what is left (both
 * paise); with no limit set it says so instead of showing a bar.
 */
export default function CreditMeter({
  limit,
  available,
  className = "",
}: {
  limit: number | null;
  available: number | null;
  className?: string;
}) {
  if (limit === null || limit <= 0 || available === null) {
    return (
      <div className={`rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-3.5 flex items-center gap-2.5 ${className}`}>
        <Icon3D name="credit-gauge" size={40} />
        <span className="text-[12.5px] font-semibold text-[var(--muted)] leading-snug">No credit limit set</span>
      </div>
    );
  }
  const used = limit > 0 ? Math.min(1.2, Math.max(0, (limit - available) / limit)) : 1;
  const tone = used >= 1 ? "var(--risk)" : used > 0.8 ? "var(--scheme)" : "var(--accent)";
  return (
    <div className={`rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-3.5 ${className}`}>
      <p className="text-[12px] font-semibold text-[var(--muted)]">Credit left</p>
      <p className="font-heading font-bold text-[22px] leading-tight mt-0.5 num">{formatINR(available, { whole: true })}</p>
      <div className="mt-2 h-1.5 rounded-full bg-[var(--surface-2)] overflow-hidden" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={limit - available} aria-label="Credit used">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, used * 100)}%`, background: tone }} />
      </div>
      <p className="text-[11px] text-[var(--muted)] mt-1.5 num">of {formatINR(limit, { whole: true })} limit</p>
    </div>
  );
}
