"use client";

import type { CatalogueProduct } from "@/lib/pricing";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import { ProductThumb, QtyControl, type CartEntry, type Offer } from "./shared";

/** One product in the storefront list. Tapping the photo or name opens the detail sheet. */
export default function ProductCard({
  product: p,
  offers,
  entry,
  onChangeAction,
  onOpenAction,
}: {
  product: CatalogueProduct;
  /** Offers that name this product, its brand or category (not store-wide ones). */
  offers: Offer[];
  entry: CartEntry | undefined;
  onChangeAction: (e: CartEntry | null) => void;
  onOpenAction: () => void;
}) {
  return (
    <div className={`card p-3 space-y-2.5 ${entry ? "ring-2 ring-[var(--kesar-tint)]" : ""}`}>
      <button type="button" onClick={onOpenAction} className="flex gap-3 w-full text-left min-w-0">
        <ProductThumb name={p.name} imageKey={p.images[0]} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-sm leading-snug break-words">{p.name}</span>
          {(p.nameHi || p.brand) && (
            <span className="block text-xs text-[var(--muted)] mt-0.5 truncate">
              {p.nameHi}
              {p.nameHi && p.brand ? " · " : ""}
              {p.brand?.name}
            </span>
          )}
          <span className="block mt-1 text-sm">
            <span className="font-bold">{formatINR(p.price)}</span>
            <span className="text-[var(--muted)]"> / {p.unit}</span>
            {p.mrp > p.price && <span className="ml-1.5 text-xs line-through text-[var(--muted)]">MRP {formatINR(p.mrp)}</span>}
          </span>
        </span>
      </button>

      <div className="flex flex-wrap gap-1.5">
        {p.margin !== null && p.margin > 0 && <span className="chip chip-mint !py-0.5 !text-[11.5px]">{p.margin}% margin</span>}
        {p.gstRate > 0 && <span className="chip !py-0.5 !text-[11.5px]">GST {p.gstRate}%</span>}
        {p.caseSize && (
          <span className="chip !py-0.5 !text-[11.5px]">
            {p.caseUnit || "case"} of {p.caseSize}
          </span>
        )}
        {p.moq > 1 && <span className="chip chip-genda !py-0.5 !text-[11.5px]">Min {p.moq} {p.unit}</span>}
        {p.priceSource === "retailer" && <span className="chip chip-mor !py-0.5 !text-[11.5px]">Your rate</span>}
      </div>

      {(offers.length > 0 || p.specialOffer) && (
        <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--kesar-text)]">
          <Icon name="tag" className="h-3.5 w-3.5 mt-px shrink-0" />
          <span className="min-w-0 break-words">
            {offers.length > 0 ? offers[0].summary : p.specialOffer}
            {offers.length > 1 && <span className="text-[var(--muted)] font-medium"> · +{offers.length - 1} more</span>}
          </span>
        </p>
      )}

      <div className="flex justify-end">
        <QtyControl product={p} entry={entry} onChangeAction={onChangeAction} />
      </div>
    </div>
  );
}
