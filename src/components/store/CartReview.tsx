"use client";

import Link from "next/link";
import { useState } from "react";
import type { CatalogueProduct } from "@/lib/pricing";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import { formatDay, qtyLabel } from "./format";
import { QtyControl, Sheet, type Cart, type CartEntry, type CartRules, type QuoteJson } from "./shared";

export type PlaceError = { status: number; message: string };

/**
 * Cart review sheet. Everything money-related comes from the server quote;
 * while a fresh quote is on its way the last one is shown dimmed and Place
 * order waits.
 */
export default function CartReview({
  open,
  cart,
  products,
  rules,
  quote,
  fresh,
  quoteError,
  coupon,
  deliveryDate,
  notes,
  placing,
  placeError,
  forRetailer,
  submitLabel,
  onCloseAction,
  onEntryAction,
  onCouponAction,
  onDateAction,
  onNotesAction,
  onPlaceAction,
  onRetryAction,
}: {
  open: boolean;
  cart: Cart;
  products: Map<string, CatalogueProduct>;
  rules: CartRules;
  /** Latest quote we have (may be for an older cart while `fresh` is false). */
  quote: QuoteJson | null;
  fresh: boolean;
  quoteError: string | null;
  coupon: string;
  deliveryDate: string | null;
  notes: string;
  placing: boolean;
  placeError: PlaceError | null;
  /** The signed-in retailer is ordering for themselves (shows the khata link on a wallet shortfall). */
  forRetailer: boolean;
  submitLabel: string;
  onCloseAction: () => void;
  onEntryAction: (productId: string, e: CartEntry | null) => void;
  onCouponAction: (code: string) => void;
  onDateAction: (d: string) => void;
  onNotesAction: (s: string) => void;
  onPlaceAction: () => void;
  /** Price the cart again after a failed quote. */
  onRetryAction: () => void;
}) {
  const [couponText, setCouponText] = useState(coupon);
  const ids = Object.keys(cart);
  const lineFor = (id: string) => quote?.lines.find((l) => l.productId === id);
  const dates = quote?.deliveryDates ?? rules.deliveryDates;
  const chosenDate = deliveryDate ?? quote?.deliveryDate ?? dates[0] ?? null;
  const canPlace = fresh && !!quote && quote.problems.length === 0 && !placing && ids.length > 0;
  const freeDeliveryGap =
    quote && rules.freeDeliveryAbove !== null && quote.deliveryCharge > 0 && quote.goodsValue < rules.freeDeliveryAbove
      ? rules.freeDeliveryAbove - quote.goodsValue
      : 0;

  return (
    <Sheet
      open={open}
      title={`Your cart · ${ids.length} item${ids.length === 1 ? "" : "s"}`}
      onCloseAction={onCloseAction}
      footer={
        <div className="space-y-2">
          {placeError && (
            <div className="rounded-xl bg-[#fde4e1] text-[#a8281e] p-3 text-sm font-semibold">
              <p>{placeError.message}</p>
              {placeError.status === 402 && forRetailer && (
                <Link href="/retailer/khata" className="inline-flex items-center gap-1 mt-1 underline">
                  Add money to your wallet <Icon name="arrow" className="h-3.5 w-3.5" />
                </Link>
              )}
              {placeError.status === 409 && <p className="font-medium text-xs mt-1">Prices have been checked again. Review the cart and try once more.</p>}
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-[var(--muted)]">Total with GST</p>
              <p className={`font-heading font-bold text-xl leading-tight ${fresh ? "" : "opacity-50"}`}>
                {quote ? formatINR(quote.totalAmount) : "…"}
              </p>
            </div>
            {quoteError && !fresh ? (
              <button type="button" className="btn btn-outline flex-1 max-w-[60%]" onClick={onRetryAction}>
                Check prices again
              </button>
            ) : (
              <button type="button" className="btn btn-kesar flex-1 max-w-[60%]" disabled={!canPlace} onClick={onPlaceAction}>
                {placing ? "Placing…" : !fresh ? "Checking prices…" : submitLabel}
              </button>
            )}
          </div>
        </div>
      }
    >
      {ids.length === 0 ? (
        <p className="text-sm text-[var(--muted)] text-center py-6">Your cart is empty.</p>
      ) : (
        <div className={`space-y-5 transition-opacity ${fresh ? "" : "opacity-70"}`}>
          {/* Lines */}
          <div className="divide-y divide-[var(--line)]">
            {ids.map((id) => {
              const p = products.get(id);
              if (!p) return null;
              const l = lineFor(id);
              return (
                <div key={id} className="py-3 first:pt-0 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm break-words">{p.name}</p>
                      {l ? (
                        <p className="text-xs text-[var(--muted)] mt-0.5">
                          {qtyLabel(l.quantity, l.unit, l.cases, l.caseSize, l.caseUnit)} · {formatINR(l.price)} / {l.unit}
                          {l.gstRate > 0 && ` · GST ${l.gstRate}%`}
                        </p>
                      ) : (
                        <p className="text-xs text-[var(--muted)] mt-0.5">{formatINR(p.price)} / {p.unit}</p>
                      )}
                      {l && l.discount > 0 && (
                        <p className="text-xs font-semibold text-[var(--mint-text)] mt-0.5">
                          −{formatINR(l.discount)}
                          {l.schemes.length > 0 && ` · ${l.schemes.join(", ")}`}
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-bold">{l ? formatINR(l.total) : "…"}</span>
                  </div>
                  <div className="flex justify-end">
                    <QtyControl product={p} entry={cart[id]} onChangeAction={(e) => onEntryAction(id, e)} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Free goods */}
          {quote && quote.free.length > 0 && (
            <div className="rounded-xl bg-[var(--mint-tint)] p-3 space-y-2">
              {quote.free.map((f) => (
                <div key={`${f.schemeId}-${f.productId}`} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--mint-text)] break-words">
                      {f.name} · {f.quantity} {f.unit}
                    </p>
                    <p className="text-xs text-[var(--ink-2)]">
                      {f.schemeName} · worth {formatINR(f.value)}
                    </p>
                  </div>
                  <span className="chip chip-mint !bg-white shrink-0">FREE</span>
                </div>
              ))}
            </div>
          )}

          {/* Schemes used */}
          {quote && quote.applied.length > 0 && (
            <div className="space-y-1.5">
              <p className="page-kick">Schemes applied</p>
              {quote.applied.map((a) => (
                <div key={a.schemeId} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{a.name}</p>
                    <p className="text-xs text-[var(--muted)]">
                      {a.summary}
                      {a.capped && " · limited, the scheme is nearly used up"}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-[var(--mint-text)]">Save {formatINR(a.value)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Nudges */}
          {quote && (quote.shortBy > 0 || freeDeliveryGap > 0) && (
            <div className="space-y-1.5">
              {quote.shortBy > 0 && (
                <p className="rounded-xl bg-[var(--genda-tint)] text-[var(--genda-text)] px-3 py-2 text-sm font-semibold">
                  Add {formatINR(quote.shortBy)} more to order (minimum {formatINR(quote.minOrderValue, { whole: true })} of goods)
                </p>
              )}
              {freeDeliveryGap > 0 && (
                <p className="rounded-xl bg-[var(--mint-tint)] text-[var(--mint-text)] px-3 py-2 text-sm font-semibold">
                  {formatINR(freeDeliveryGap)} more for free delivery
                </p>
              )}
            </div>
          )}

          {/* Coupon */}
          <div className="space-y-1.5">
            <p className="page-kick">Coupon</p>
            {coupon ? (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-sm">{coupon}</p>
                  {quote?.coupon && quote.coupon.code === coupon && (
                    <p className={`text-xs font-semibold ${quote.coupon.valid ? "text-[var(--mint-text)]" : "text-[#a8281e]"}`}>
                      {quote.coupon.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-quiet btn-xs shrink-0"
                  onClick={() => {
                    setCouponText("");
                    onCouponAction("");
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const code = couponText.trim().toUpperCase().slice(0, 30);
                  if (code) onCouponAction(code);
                }}
              >
                <input
                  className="input !py-2 flex-1 min-w-0 uppercase"
                  placeholder="Coupon code"
                  value={couponText}
                  onChange={(e) => setCouponText(e.target.value)}
                  autoCapitalize="characters"
                />
                <button type="submit" className="btn btn-soft btn-sm shrink-0" disabled={!couponText.trim()}>
                  Apply
                </button>
              </form>
            )}
          </div>

          {/* Delivery day */}
          <div className="space-y-1.5">
            <p className="page-kick">Delivery</p>
            {rules.allowDateChoice && dates.length > 1 ? (
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
                {dates.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onDateAction(d)}
                    aria-pressed={d === chosenDate}
                    className={`chip shrink-0 !py-2 ${d === chosenDate ? "chip-mor" : ""}`}
                  >
                    {formatDay(d)}
                  </button>
                ))}
              </div>
            ) : chosenDate ? (
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Icon name="truck" className="h-4 w-4 text-[var(--mor)]" /> Delivery: {formatDay(chosenDate)}
              </p>
            ) : (
              <p className="text-sm text-[var(--muted)]">No delivery day available right now.</p>
            )}
            {rules.cutoffTime && <p className="text-xs text-[var(--muted)]">Orders after {rules.cutoffTime} go a day later.</p>}
          </div>

          {/* Notes */}
          <label className="block space-y-1.5">
            <span className="page-kick block">Note for the distributor</span>
            <textarea
              className="input min-h-[64px]"
              maxLength={500}
              placeholder="Optional"
              value={notes}
              onChange={(e) => onNotesAction(e.target.value)}
            />
          </label>

          {/* Totals */}
          {quote && (
            <div className="card p-3 space-y-1 text-sm">
              <Row label="Goods" value={formatINR(quote.grossAmount)} />
              {quote.discountAmount > 0 && <Row label="Scheme discount" value={`−${formatINR(quote.discountAmount)}`} mint />}
              <Row label="Delivery charge" value={quote.deliveryCharge > 0 ? formatINR(quote.deliveryCharge) : "Free"} />
              {quote.gstAmount > 0 && <Row label="GST" value={formatINR(quote.gstAmount)} />}
              <div className="flex justify-between font-bold pt-1 border-t border-[var(--line)] mt-1">
                <span>Total</span>
                <span>{formatINR(quote.totalAmount)}</span>
              </div>
            </div>
          )}

          {quoteError && <p className="text-sm font-semibold text-[#a8281e]">{quoteError}</p>}
          {fresh && quote && quote.problems.length > 0 && (
            <ul className="rounded-xl bg-[#fde4e1] text-[#a8281e] p-3 text-sm space-y-1 list-disc pl-7">
              {quote.problems.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Row({ label, value, mint }: { label: string; value: string; mint?: boolean }) {
  return (
    <div className={`flex justify-between ${mint ? "text-[var(--mint-text)] font-semibold" : "text-[var(--ink-2)]"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
