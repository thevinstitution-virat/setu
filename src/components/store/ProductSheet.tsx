"use client";

import type { CatalogueProduct } from "@/lib/pricing";
import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import { fileUrl } from "./format";
import { endsLabel, ProductThumb, QtyControl, Sheet, unitsOf, type CartEntry, type Offer } from "./shared";

/** Product detail: photos, description, rate breakdown and every offer on it. */
export default function ProductSheet({
  product: p,
  offers,
  entry,
  priceList,
  lineTotal,
  onChangeAction,
  onCloseAction,
}: {
  product: CatalogueProduct | null;
  /** All offers covering it, store-wide ones included. */
  offers: Offer[];
  entry: CartEntry | undefined;
  priceList: string | null;
  /** This product's line total from the latest quote (with discount and GST). */
  lineTotal?: number | null;
  onChangeAction: (e: CartEntry | null) => void;
  onCloseAction: () => void;
}) {
  if (!p) return null;
  const units = entry ? unitsOf(entry, p) : 0;
  return (
    <Sheet
      open
      title={p.name}
      onCloseAction={onCloseAction}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted)]">{entry ? `${units} ${p.unit} in cart` : "Not in cart"}</p>
            {entry && lineTotal != null ? (
              <p className="font-bold">
                {formatINR(lineTotal)} <span className="text-xs font-medium text-[var(--muted)]">with GST</span>
              </p>
            ) : (
              <p className="font-bold">
                {formatINR(p.price)} <span className="text-xs font-medium text-[var(--muted)]">/ {p.unit}</span>
              </p>
            )}
          </div>
          <QtyControl product={p} entry={entry} onChangeAction={onChangeAction} />
        </div>
      }
    >
      <div className="space-y-4">
        {p.images.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto snap-x snap-mandatory [scrollbar-width:none]">
            {p.images.map((k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={k}
                src={fileUrl(k)}
                alt={p.name}
                className="snap-center shrink-0 w-full max-w-full aspect-square sm:aspect-[4/3] object-contain rounded-2xl bg-white"
              />
            ))}
          </div>
        ) : (
          <ProductThumb name={p.name} className="h-28 w-28 mx-auto !text-4xl" />
        )}

        <div>
          {p.nameHi && <p className="text-base font-semibold">{p.nameHi}</p>}
          <p className="text-sm text-[var(--muted)]">
            {[p.brand?.name, p.category.name, `SKU ${p.sku}`].filter(Boolean).join(" · ")}
          </p>
        </div>

        <div className="card p-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Fact label="Your rate" value={`${formatINR(p.price)} / ${p.unit}`} strong />
          <Fact label="MRP" value={formatINR(p.mrp)} />
          {p.margin !== null && <Fact label="Your margin" value={`${p.margin}%`} />}
          <Fact label="GST" value={p.gstRate > 0 ? `${p.gstRate}%` : "Nil"} />
          {p.caseSize && <Fact label="Case" value={`${p.caseUnit || "case"} of ${p.caseSize} ${p.unit}`} />}
          {p.moq > 1 && <Fact label="Minimum order" value={`${p.moq} ${p.unit}`} />}
          {p.priceSource !== "default" && (
            <p className="col-span-2 text-xs text-[var(--mint-text)] font-semibold">
              {p.priceSource === "retailer" ? "Special rate for your shop" : `Rate from ${priceList ?? "your price list"}`}
              {p.basePrice > p.price && <> · usual {formatINR(p.basePrice)}</>}
            </p>
          )}
        </div>

        {p.description && <p className="text-sm text-[var(--ink-2)] whitespace-pre-line">{p.description}</p>}

        {(offers.length > 0 || p.specialOffer) && (
          <div className="space-y-2">
            <p className="page-kick">Offers</p>
            {offers.map((o) => (
              <div key={o.id} className="rounded-xl bg-[var(--kesar-tint)] p-3">
                <p className="flex items-center gap-1.5 text-sm font-bold text-[var(--kesar-text)]">
                  <Icon name="tag" className="h-4 w-4 shrink-0" />
                  {o.summary}
                </p>
                <p className="text-xs text-[var(--ink-2)] mt-0.5">
                  {o.name}
                  {endsLabel(o.endsAt) && ` · ${endsLabel(o.endsAt)}`}
                </p>
                {o.description && <p className="text-xs text-[var(--ink-2)] mt-1">{o.description}</p>}
              </div>
            ))}
            {p.specialOffer && <p className="text-sm font-semibold text-[var(--kesar-text)]">{p.specialOffer}</p>}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className={`break-words ${strong ? "font-bold" : "font-medium"}`}>{value}</p>
    </div>
  );
}
