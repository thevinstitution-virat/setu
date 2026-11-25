"use client";

import { formatINR } from "@/lib/money";
import { qtyLabel } from "@/components/store/format";
import type { QuoteJson } from "@/components/store/shared";

/**
 * Step 3: the server's price for the sale — lines, free goods, totals,
 * problems (red, stop the sale) and warnings (amber). Dimmed while a newer
 * price check is on its way.
 */
export default function BillCard({
  quote,
  fresh,
  error,
  onRetryAction,
}: {
  quote: QuoteJson | null;
  fresh: boolean;
  error: string | null;
  onRetryAction: () => void;
}) {
  if (!quote) {
    return error ? (
      <QuoteError message={error} onRetryAction={onRetryAction} />
    ) : (
      <p className="text-sm text-[var(--muted)]">Checking prices…</p>
    );
  }

  return (
    <div className={`space-y-3 transition-opacity ${fresh ? "" : "opacity-60"}`}>
      <ul className="divide-y divide-[var(--line)]">
        {quote.lines.map((l) => (
          <li key={l.productId} className="py-2.5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold break-words">{l.name}</p>
              <p className="text-xs text-[var(--muted)]">
                {qtyLabel(l.quantity, l.unit, l.cases, l.caseSize, l.caseUnit)} × {formatINR(l.price)}
                {l.gstRate > 0 ? ` · GST ${l.gstRate}%` : ""}
              </p>
              {l.discount > 0 && (
                <p className="text-xs font-semibold text-[var(--mint-text)]">
                  −{formatINR(l.discount)}
                  {l.schemes.length > 0 ? ` · ${l.schemes.join(", ")}` : ""}
                </p>
              )}
            </div>
            <span className="text-sm font-bold shrink-0">{formatINR(l.total)}</span>
          </li>
        ))}
      </ul>

      {quote.free.length > 0 && (
        <div className="rounded-xl bg-[var(--mint-tint)] p-3 space-y-2">
          {quote.free.map((f) => (
            <div key={`${f.schemeId}-${f.productId}`} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold text-[var(--mint-text)] break-words">
                  {f.name} · {f.quantity} {f.unit}
                </p>
                <p className="text-xs text-[var(--ink-2)]">{f.schemeName}. Hand it over from the van too.</p>
              </div>
              <span className="chip chip-mint !bg-white shrink-0">FREE</span>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-[var(--line)] pt-3 space-y-1 text-sm">
        <Row label="Goods" value={formatINR(quote.grossAmount)} />
        {quote.discountAmount > 0 && <Row label="Scheme discount" value={`−${formatINR(quote.discountAmount)}`} mint />}
        {quote.deliveryCharge > 0 && <Row label="Delivery charge" value={formatINR(quote.deliveryCharge)} />}
        {quote.gstAmount > 0 && <Row label="GST" value={formatINR(quote.gstAmount)} />}
        {!!quote.roundOff && <Row label="Round off" value={`${quote.roundOff > 0 ? "+" : "−"}${formatINR(Math.abs(quote.roundOff))}`} />}
        <div className="flex items-end justify-between gap-3 pt-1">
          <span className="text-xs text-[var(--muted)]">Total</span>
          <span className="font-heading font-bold text-xl">{formatINR(quote.totalAmount)}</span>
        </div>
      </div>

      {error && <QuoteError message={error} onRetryAction={onRetryAction} />}
      {fresh && quote.problems.length > 0 && (
        <ul role="alert" className="rounded-xl bg-[#fde4e1] text-[#a8281e] p-3 text-sm font-semibold space-y-1 list-disc pl-7">
          {quote.problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {fresh && quote.warnings.length > 0 && (
        <ul className="rounded-xl bg-[var(--genda-tint)] text-[var(--genda-text)] p-3 text-sm font-semibold space-y-1 list-disc pl-7">
          {quote.warnings.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuoteError({ message, onRetryAction }: { message: string; onRetryAction: () => void }) {
  return (
    <div className="rounded-xl bg-[#fde4e1] text-[#a8281e] p-3 text-sm font-semibold space-y-2">
      <p>{message}</p>
      <button type="button" className="btn btn-outline btn-sm" onClick={onRetryAction}>
        Check prices again
      </button>
    </div>
  );
}

function Row({ label, value, mint }: { label: string; value: string; mint?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${mint ? "text-[var(--mint-text)] font-semibold" : "text-[var(--ink-2)]"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
