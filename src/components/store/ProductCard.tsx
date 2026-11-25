"use client";

import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import { fileUrl } from "./format";
import { ProductThumb, QtyControl, StockChip, type CartEntry, type Offer, type StoreProduct } from "./shared";

/**
 * One product in the storefront. Two layouts: "grid" (two columns on a phone:
 * packshot, brand chip, name, pack, price, margin badge, scheme ribbon, stepper)
 * and "list" (a row per product). Tapping the picture or name opens the
 * detail sheet. Out of stock: muted, but still tappable and addable.
 */
export default function ProductCard({
  product: p,
  offers,
  entry,
  variant = "grid",
  onChangeAction,
  onOpenAction,
}: {
  product: StoreProduct;
  /** Offers that name this product, its brand or category (not store-wide ones). */
  offers: Offer[];
  entry: CartEntry | undefined;
  variant?: "grid" | "list";
  onChangeAction: (e: CartEntry | null) => void;
  onOpenAction: () => void;
}) {
  const pack = p.caseSize ? `${p.caseUnit || "Case"} of ${p.caseSize}` : p.unit;
  const offerText = offers.length > 0 ? offers[0].summary : p.specialOffer;
  const showMargin = p.margin !== null && p.margin > 0;

  if (variant === "list") {
    return (
      <div data-product-card className={`card p-3 space-y-2.5 ${entry ? "ring-2 ring-[var(--accent)]" : ""}`}>
        <button type="button" onClick={onOpenAction} className={`flex gap-3 w-full text-left min-w-0 ${p.stock === "out" ? "opacity-60" : ""}`}>
          <ProductThumb name={p.name} imageKey={p.images[0]} category={p.category.name} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-sm leading-snug line-clamp-2 break-words">{p.name}</span>
            {(p.nameHi || p.brand) && (
              <span className="block text-xs text-[var(--muted)] mt-0.5 truncate">
                {p.nameHi}
                {p.nameHi && p.brand ? " · " : ""}
                {p.brand?.name}
              </span>
            )}
            <span className="block text-xs text-[var(--muted)] mt-0.5">{pack}</span>
            <span className="block mt-1 text-sm">
              <span className="font-heading font-bold num">{formatINR(p.price)}</span>
              <span className="text-[var(--muted)]"> / {p.unit}</span>
              {p.mrp > p.price && <span className="ml-1.5 text-xs line-through text-[var(--muted)] num">MRP {formatINR(p.mrp)}</span>}
            </span>
          </span>
        </button>

        <div className="flex flex-wrap gap-1.5">
          <StockChip stock={p.stock} />
          {showMargin && <span className="chip chip-scheme !py-0.5 !text-[11.5px]">{p.margin}% margin</span>}
          {p.gstRate > 0 && <span className="chip chip-neutral !py-0.5 !text-[11.5px]">GST {p.gstRate}%</span>}
          {p.moq > 1 && (
            <span className="chip chip-neutral !py-0.5 !text-[11.5px]">
              Min {p.moq} {p.unit}
            </span>
          )}
          {p.priceSource === "retailer" && <span className="chip chip-mor !py-0.5 !text-[11.5px]">Your rate</span>}
        </div>

        {offerText && (
          <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--scheme-text)] bg-[var(--scheme-tint)] rounded-lg px-2 py-1">
            <Icon name="tag" className="h-3.5 w-3.5 mt-px shrink-0" />
            <span className="min-w-0 break-words">
              {offerText}
              {offers.length > 1 && <span className="font-medium"> · +{offers.length - 1} more</span>}
            </span>
          </p>
        )}

        <div className="flex justify-end">
          <QtyControl product={p} entry={entry} onChangeAction={onChangeAction} />
        </div>
      </div>
    );
  }

  return (
    <div data-product-card className={`card p-2.5 flex flex-col gap-2 min-w-0 ${entry ? "ring-2 ring-[var(--accent)]" : ""}`}>
      <button type="button" onClick={onOpenAction} className={`text-left space-y-1.5 min-w-0 ${p.stock === "out" ? "opacity-60" : ""}`}>
        <span className="relative grid place-items-center aspect-[1.15] w-full overflow-hidden rounded-[12px] bg-[var(--surface-2)]">
          {p.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(p.images[0])} alt="" loading="lazy" className="h-full w-full object-contain p-2" />
          ) : (
            <ProductThumb name={p.name} category={p.category.name} className="h-full w-full !rounded-none bg-transparent" iconSize={64} />
          )}
          {showMargin && <span className="absolute left-1.5 top-1.5 rounded-md bg-[var(--scheme)] text-[#1a1200] text-[10.5px] font-extrabold px-1.5 py-0.5">{p.margin}% margin</span>}
          {offerText && (
            <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-[var(--scheme)] text-[#1a1200] text-[10.5px] font-extrabold px-2 py-0.5 truncate">
              <Icon name="tag" className="h-3 w-3 shrink-0" weight="fill" />
              <span className="truncate">{offerText}</span>
            </span>
          )}
        </span>
        {p.brand && <span className="inline-block max-w-full truncate rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] font-bold text-[var(--muted)]">{p.brand.name}</span>}
        <span className="block font-semibold text-[13px] leading-snug line-clamp-2 break-words min-h-[2.6em]">{p.name}</span>
        <span className="block text-[11.5px] text-[var(--muted)] truncate">{pack}</span>
        <span className="flex items-baseline gap-1.5">
          <span className="font-heading font-bold text-[15px] num">{formatINR(p.price)}</span>
          {p.mrp > p.price && <span className="text-[11px] line-through text-[var(--muted)] num">{formatINR(p.mrp)}</span>}
        </span>
      </button>
      {(p.stock || p.moq > 1) && (
        <div className="flex flex-wrap gap-1">
          <StockChip stock={p.stock} />
          {p.moq > 1 && (
            <span className="chip chip-neutral !py-0.5 !text-[11px]">
              Min {p.moq} {p.unit}
            </span>
          )}
        </div>
      )}
      <div className="mt-auto flex justify-end">
        <QtyControl product={p} entry={entry} onChangeAction={onChangeAction} compact />
      </div>
    </div>
  );
}
