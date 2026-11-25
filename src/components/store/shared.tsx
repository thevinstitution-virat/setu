"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogueProduct, OfferedScheme, Quote } from "@/lib/pricing";
import { fileUrl } from "./format";
import Icon from "@/components/Icon";
import { Icon3D } from "@/components/icons3d/Icon3D";
import { categoryIcon } from "@/lib/ui/categoryIcons";
import { flyToCart } from "@/lib/ui/fly";

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
  /** The shop's usual order (A2): products in at least half of its recent orders, at the usual quantity (units). */
  usual?: { basedOn: number; lines: { productId: string; qty: number; times: number; of: number }[] };
  /** A1: the "Type or speak your order" card is on. */
  orderText?: boolean;
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

// ───────────── small components ─────────────

/** "Out of stock" / "Few left" chip. Ordering stays open: the business may only warn. */
export function StockChip({ stock, className = "" }: { stock: StockBadge | undefined; className?: string }) {
  if (stock === "out") {
    return <span className={`chip chip-risk !py-0.5 !text-[11.5px] ${className}`}>Out of stock</span>;
  }
  if (stock === "low") return <span className={`chip chip-genda !py-0.5 !text-[11.5px] ${className}`}>Few left</span>;
  return null;
}

/**
 * A product picture. With no photo it shows the 3D icon of the product's
 * category (matched from the category name, then the product name; sealed box
 * when nothing matches), never the first letter.
 */
export function ProductThumb({
  name,
  imageKey,
  category,
  className = "h-16 w-16",
  iconSize = 40,
}: {
  name: string;
  imageKey?: string | null;
  category?: string | null;
  className?: string;
  /** Pixel size of the fallback icon (about 60% of the thumb). */
  iconSize?: number;
}) {
  if (imageKey) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={fileUrl(imageKey)} alt="" loading="lazy" className={`${className} shrink-0 rounded-xl object-cover bg-white`} />
    );
  }
  return (
    <span aria-hidden="true" className={`${className} shrink-0 rounded-xl grid place-items-center bg-[var(--surface-2)]`}>
      <Icon3D name={categoryIcon(category ? `${category} ${name}` : name)} size={iconSize} />
    </span>
  );
}

/** Bottom sheet on phones, centred dialog from md up. Drag handle, blurred backdrop, focus kept inside. */
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
  const panel = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const startY = useRef<number | null>(null);
  useEffect(() => {
    close.current = onCloseAction;
  }, [onCloseAction]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close.current();
      if (e.key !== "Tab" || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      before?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center md:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-[rgba(8,38,37,0.45)] backdrop-blur-[22px] cursor-default"
        onClick={onCloseAction}
      />
      <div
        ref={panel}
        style={drag ? { transform: `translateY(${drag}px)`, transition: "none" } : undefined}
        className="sheet-panel relative w-full md:max-w-lg max-h-[90dvh] flex flex-col rounded-t-[28px] md:rounded-[28px] bg-[var(--surface)] shadow-[var(--e-3)]"
      >
        {/* Drag handle: pull down to close on a phone. */}
        <div
          className="md:hidden grid place-items-center pt-2.5 pb-1 touch-none cursor-grab"
          onPointerDown={(e) => {
            startY.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (startY.current !== null) setDrag(Math.max(0, e.clientY - startY.current));
          }}
          onPointerUp={() => {
            if (drag > 110) onCloseAction();
            startY.current = null;
            setDrag(0);
          }}
        >
          <span className="h-1.5 w-10 rounded-full bg-[var(--line-2)]" />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 pt-2 md:pt-4 pb-3 border-b border-[var(--line)]">
          <p className="font-heading font-bold text-lg truncate min-w-0">{title}</p>
          <button
            type="button"
            data-sheet-close
            aria-label="Close"
            className="grid place-items-center h-10 w-10 shrink-0 rounded-full bg-[var(--surface-2)] hover:bg-[var(--line)]"
            onClick={onCloseAction}
          >
            <Icon name="x" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
        {footer && <div className="border-t border-[var(--line)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

/** Press and hold to repeat: first after 380ms, then every 110ms. */
function useHold(fn: () => void) {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  const timers = useRef<{ t?: number; i?: number }>({});
  const stop = useCallback(() => {
    window.clearTimeout(timers.current.t);
    window.clearInterval(timers.current.i);
  }, []);
  useEffect(() => stop, [stop]);
  return {
    onPointerDown: () => {
      stop();
      timers.current.t = window.setTimeout(() => {
        timers.current.i = window.setInterval(() => latest.current(), 110);
      }, 380);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onClick: () => latest.current(),
  };
}

/**
 * Add button that morphs into a "− qty +" stepper. Products sold in cases get
 * a units ↔ cases toggle; switching converts the count. The middle number can
 * be typed, and − / + repeat while held. Buttons are 48px tall for thumbs.
 * The first add flies a thumbnail to the cart bar.
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
  /** Narrow cards: no "+ 1 case" shortcut next to Add. */
  compact?: boolean;
}) {
  const hasCase = !!p.caseSize && p.caseSize > 1;
  const caseName = p.caseUnit || "case";

  const step = (d: number) => {
    if (!entry) return;
    const next = entry.qty + d;
    const min = entry.mode === "units" ? Math.max(1, p.moq) : 1;
    if (next < min) return onChangeAction(null);
    onChangeAction({ ...entry, qty: Math.min(MAX_QTY, next) });
  };
  const less = useHold(() => step(-1));
  const more = useHold(() => step(1));

  if (!entry) {
    return (
      <div className="flex items-center gap-1.5">
        {hasCase && !compact && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={(e) => {
              flyToCart(e.currentTarget);
              onChangeAction({ mode: "cases", qty: startQty(p, "cases") });
            }}
          >
            + 1 {caseName}
          </button>
        )}
        <button
          type="button"
          className="add-btn"
          onClick={(e) => {
            flyToCart(e.currentTarget);
            onChangeAction({ mode: "units", qty: startQty(p, "units") });
          }}
        >
          Add
        </button>
      </div>
    );
  }

  function switchMode(mode: CartEntry["mode"]) {
    if (mode === entry!.mode || !p.caseSize) return;
    const qty = mode === "cases" ? Math.max(1, Math.round(entry!.qty / p.caseSize)) : entry!.qty * p.caseSize;
    onChangeAction({ mode, qty });
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {hasCase && (
        <div className="inline-flex rounded-lg bg-[var(--surface-2)] p-0.5 text-[11.5px] font-bold" role="group" aria-label="Order in">
          {(["units", "cases"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={entry.mode === m}
              onClick={() => switchMode(m)}
              className={`px-2.5 min-h-8 rounded-md ${entry.mode === m ? "bg-white shadow-sm text-[var(--ink)]" : "text-[var(--muted)]"}`}
            >
              {m === "units" ? p.unit : caseName}
            </button>
          ))}
        </div>
      )}
      <div className="stepper-pop inline-flex items-center rounded-[12px] bg-[var(--accent)] text-[var(--accent-on)]">
        <button type="button" aria-label="One less" className="step-btn" {...less}>
          <Icon name="minus" className="h-4 w-4" weight="bold" />
        </button>
        <QtyInput value={entry.qty} onCommitAction={(q) => (q > 0 ? onChangeAction({ ...entry, qty: Math.min(MAX_QTY, q) }) : onChangeAction(null))} />
        <button type="button" aria-label="One more" className="step-btn" {...more}>
          <Icon name="plus" className="h-4 w-4" weight="bold" />
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
      className="h-12 w-10 bg-transparent text-center text-[15px] font-extrabold outline-none num text-inherit"
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
