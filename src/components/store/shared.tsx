"use client";

import { useEffect, useRef, useState } from "react";
import type { CatalogueProduct, OfferedScheme, Quote } from "@/lib/pricing";
import { fileUrl } from "./format";

// ───────────── API shapes (JSON: dates arrive as strings) ─────────────

export type Offer = Omit<OfferedScheme, "endsAt"> & { endsAt: string | null };
export type Category = { id: string; name: string; parentId: string | null; imageKey: string | null };
export type Brand = { id: string; name: string; logoKey: string | null };
export type Banner = {
  id: string;
  title: string;
  subtitle: string | null;
  imageKey: string | null;
  linkType: string | null;
  linkId: string | null;
};
export type CartRules = {
  minOrderValue: number;
  deliveryCharge: number;
  freeDeliveryAbove: number | null;
  allowDateChoice: boolean;
  cutoffTime: string;
  deliveryDates: string[];
};
/** Stock badge from GET /api/catalogue (null = nothing to say, or stock isn't tracked). */
export type StockBadge = "out" | "low" | null;
export type StoreProduct = CatalogueProduct & { stock?: StockBadge };
export type CatalogueData = {
  retailer: { id: string; outletName: string; area: string; priceList: string | null };
  products: StoreProduct[];
  categories: Category[];
  brands: Brand[];
  banners: Banner[];
  offers: Offer[];
  buyAgain: string[];
  cart: CartRules;
};
export type QuoteJson = Omit<Quote, "offers"> & { offers: Offer[] };
export type PlacedOrder = { id: string; orderNumber: string; totalAmount: number };

/** What the retailer has in the cart: a count in units, or in cases. */
export type CartEntry = { qty: number; mode: "units" | "cases" };
export type Cart = Record<string, CartEntry>;

export type StoreFilters = {
  q?: string | null;
  category?: string | null;
  brand?: string | null;
  scheme?: string | null;
  product?: string | null;
};

// ───────────── helpers ─────────────

export const isScoped = (o: Offer) => o.productIds.length > 0 || o.brandIds.length > 0 || o.categoryIds.length > 0;

/** Offer covers a product: no scope at all, or the product / its brand / any of its categories is listed. */
export function offerCovers(o: Offer, p: CatalogueProduct): boolean {
  if (!isScoped(o)) return true;
  return (
    o.productIds.includes(p.id) || (!!p.brand && o.brandIds.includes(p.brand.id)) || p.categoryPath.some((c) => o.categoryIds.includes(c))
  );
}

export const MAX_QTY = 100_000;

/** Units an entry stands for. */
export const unitsOf = (e: CartEntry, p: CatalogueProduct) => (e.mode === "cases" && p.caseSize ? e.qty * p.caseSize : e.qty);

/** Smallest sensible first count for a product in a mode. */
export function startQty(p: CatalogueProduct, mode: CartEntry["mode"]): number {
  if (mode === "cases" && p.caseSize) return Math.max(1, Math.ceil(p.moq / p.caseSize));
  return Math.max(1, p.moq);
}

export function endsLabel(endsAt: string | null): string | null {
  if (!endsAt) return null;
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return null;
  return `till ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}

const TINTS = [
  "bg-[var(--kesar-tint)] text-[var(--kesar-text)]",
  "bg-[var(--mint-tint)] text-[var(--mint-text)]",
  "bg-[var(--genda-tint)] text-[var(--genda-text)]",
  "bg-[#e1eeec] text-[var(--mor)]",
];
function tintFor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return TINTS[Math.abs(h) % TINTS.length];
}

// ───────────── small components ─────────────

/** "Out of stock" / "Few left" chip. Ordering stays open: the business may only warn. */
export function StockChip({ stock, className = "" }: { stock: StockBadge | undefined; className?: string }) {
  if (stock === "out") {
    return <span className={`chip !py-0.5 !text-[11.5px] !bg-[#fde4e1] !text-[#a8281e] !border-transparent ${className}`}>Out of stock</span>;
  }
  if (stock === "low") return <span className={`chip chip-genda !py-0.5 !text-[11.5px] ${className}`}>Few left</span>;
  return null;
}

export function ProductThumb({ name, imageKey, className = "h-16 w-16" }: { name: string; imageKey?: string | null; className?: string }) {
  if (imageKey) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl(imageKey)} alt="" loading="lazy" className={`${className} shrink-0 rounded-xl object-cover bg-white`} />
    );
  }
  return (
    <span aria-hidden="true" className={`${className} shrink-0 rounded-xl grid place-items-center font-heading font-bold text-xl ${tintFor(name)}`}>
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Bottom sheet on phones, centred dialog from md up. */
export function Sheet({
  open,
  title,
  onCloseAction,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onCloseAction: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const close = useRef(onCloseAction);
  useEffect(() => {
    close.current = onCloseAction;
  }, [onCloseAction]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" className="absolute inset-0 bg-[rgba(8,38,37,0.5)] cursor-default" onClick={onCloseAction} />
      <div className="relative w-full md:max-w-lg max-h-[90dvh] flex flex-col rounded-t-3xl md:rounded-3xl bg-[var(--background)] shadow-[0_-20px_50px_-20px_rgba(8,38,37,0.6)]">
        <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2.5 border-b border-[var(--line)]">
          <p className="font-heading font-bold text-lg truncate min-w-0">{title}</p>
          <button type="button" className="btn btn-quiet btn-xs shrink-0" onClick={onCloseAction}>
            Close
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Add button / stepper. Products sold in cases get a units ↔ cases toggle;
 * switching converts the count. The middle number can be typed.
 */
export function QtyControl({
  product: p,
  entry,
  onChangeAction,
  compact = false,
}: {
  product: CatalogueProduct;
  entry: CartEntry | undefined;
  onChangeAction: (e: CartEntry | null) => void;
  compact?: boolean;
}) {
  const hasCase = !!p.caseSize && p.caseSize > 1;
  const caseName = p.caseUnit || "case";

  if (!entry) {
    return (
      <div className="flex items-center gap-1.5">
        {hasCase && !compact && (
          <button type="button" className="btn btn-quiet btn-xs" onClick={() => onChangeAction({ mode: "cases", qty: startQty(p, "cases") })}>
            + 1 {caseName}
          </button>
        )}
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onChangeAction({ mode: "units", qty: startQty(p, "units") })}>
          Add
        </button>
      </div>
    );
  }

  const step = (d: number) => {
    const next = entry.qty + d;
    const min = entry.mode === "units" ? Math.max(1, p.moq) : 1;
    if (next < min) return onChangeAction(null);
    onChangeAction({ ...entry, qty: Math.min(MAX_QTY, next) });
  };

  function switchMode(mode: CartEntry["mode"]) {
    if (mode === entry!.mode || !p.caseSize) return;
    const qty = mode === "cases" ? Math.max(1, Math.round(entry!.qty / p.caseSize)) : entry!.qty * p.caseSize;
    onChangeAction({ mode, qty });
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {hasCase && (
        <div className="inline-flex rounded-lg bg-ink/5 p-0.5 text-[11.5px] font-bold" role="group" aria-label="Order in">
          {(["units", "cases"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={entry.mode === m}
              onClick={() => switchMode(m)}
              className={`px-2 py-1 rounded-md ${entry.mode === m ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--muted)]"}`}
            >
              {m === "units" ? p.unit : caseName}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="One less"
          onClick={() => step(-1)}
          className="h-8 w-8 rounded-lg bg-ink/5 hover:bg-ink/10 font-bold"
        >
          −
        </button>
        <QtyInput value={entry.qty} onCommitAction={(q) => (q > 0 ? onChangeAction({ ...entry, qty: Math.min(MAX_QTY, q) }) : onChangeAction(null))} />
        <button
          type="button"
          aria-label="One more"
          onClick={() => step(1)}
          className="h-8 w-8 rounded-lg bg-[var(--kesar-tint)] text-[var(--kesar-text)] hover:brightness-95 font-bold"
        >
          +
        </button>
      </div>
    </div>
  );
}

function QtyInput({ value, onCommitAction }: { value: number; onCommitAction: (q: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      inputMode="numeric"
      aria-label="Quantity"
      className="h-8 w-11 rounded-lg border border-[var(--line)] bg-white text-center text-sm font-semibold outline-none focus:border-[var(--mor)]"
      value={text ?? String(value)}
      onFocus={(e) => {
        setText(String(value));
        e.target.select();
      }}
      onChange={(e) => {
        const v = e.target.value.replace(/\D/g, "").slice(0, 6);
        setText(v);
        const n = Number(v);
        if (v && n > 0) onCommitAction(n);
      }}
      onBlur={() => {
        if (text !== null && (!text || Number(text) === 0)) onCommitAction(0);
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
