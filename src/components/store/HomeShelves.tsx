"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { formatINR } from "@/lib/money";
import Icon from "@/components/Icon";
import { Icon3D } from "@/components/icons3d/Icon3D";
import { categoryIcon } from "@/lib/ui/categoryIcons";
import BrandFilter from "@/components/ui/BrandFilter";
import CartBar from "@/components/ui/CartBar";
import SchemeCarousel, { type SchemeBannerData } from "@/components/ui/SchemeBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { fileUrl, formatDay } from "./format";
import { endsLabel, ProductThumb, QtyControl, StockChip, type StoreProduct, type Banner, type Cart, type CartEntry, type CatalogueData, type QuoteJson } from "./shared";

const CATALOGUE = "/retailer/catalogue";

/** Where a banner leads in the catalogue (null = no link). url banners open outside. */
function bannerHref(b: Banner): string | null {
  if (!b.linkId) return null;
  const id = encodeURIComponent(b.linkId);
  switch (b.linkType) {
    case "product":
      return `${CATALOGUE}?product=${id}`;
    case "brand":
      return `${CATALOGUE}?brand=${id}`;
    case "category":
      return `${CATALOGUE}?category=${id}`;
    case "scheme":
      return `${CATALOGUE}?scheme=${id}`;
    case "url":
      return /^https:\/\//i.test(b.linkId) ? b.linkId : null;
    default:
      return null;
  }
}

/** The shop's draft cart is shared with the storefront through localStorage (setu:cart:<retailer>). */
function readCart(key: string, byId: Map<string, StoreProduct>): Cart {
  const out: Cart = {};
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? "null") as { cart?: Record<string, CartEntry> } | null;
    for (const [id, e] of Object.entries(d?.cart ?? {})) {
      const p = byId.get(id);
      if (p && e && Number.isInteger(e.qty) && e.qty > 0) out[id] = { qty: e.qty, mode: e.mode === "cases" && p.caseSize ? "cases" : "units" };
    }
  } catch {
    // no saved cart
  }
  return out;
}

/**
 * Retailer home, top to bottom: header with the next delivery, search and
 * mic, the khata and credit cards (server-rendered, passed in), scheme
 * banners, brand filter and category grid, "Order again" with steppers, then
 * the rest of the page (latest order, announcements, referral, help) and a
 * cart bar. Reads GET /api/catalogue; the cart it edits is the storefront's.
 */
export default function HomeShelves({
  shopName,
  area,
  money,
  below,
}: {
  shopName: string;
  area: string;
  money: ReactNode;
  below: ReactNode;
}) {
  const router = useRouter();
  const [data, setData] = useState<CatalogueData | null>(null);
  const [failed, setFailed] = useState(false);
  const [cart, setCart] = useState<Cart>({});
  const [q, setQ] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/catalogue")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: CatalogueData | null) => {
        if (!live) return;
        if (!d) return setFailed(true);
        setData(d);
        setCart(readCart(`setu:cart:${d.retailer.id}`, new Map(d.products.map((p) => [p.id, p]))));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const byId = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data]);

  function setEntry(id: string, e: CartEntry | null) {
    if (!data) return;
    const next = { ...cart };
    if (e) next[id] = e;
    else delete next[id];
    setCart(next);
    try {
      const key = `setu:cart:${data.retailer.id}`;
      const old = JSON.parse(localStorage.getItem(key) ?? "null") as { coupon?: string; notes?: string } | null;
      if (!Object.keys(next).length && !old?.coupon && !old?.notes) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify({ cart: next, coupon: old?.coupon ?? "", notes: old?.notes ?? "" }));
    } catch {
      // storage blocked: the cart just won't carry over
    }
  }

  // Price the cart on the server (the page never computes a price).
  const items = useMemo(
    () => Object.entries(cart).map(([productId, e]) => (e.mode === "cases" ? { productId, cases: e.qty } : { productId, quantity: e.qty })),
    [cart],
  );
  useEffect(() => {
    if (!items.length) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/cart/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          signal: ctrl.signal,
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && !ctrl.signal.aborted) setTotal((d.quote as QuoteJson).totalAmount);
      } catch {
        // offline: the bar keeps the last total
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [items]);

  const nextDelivery = data?.cart.deliveryDates[0] ?? null;
  const cats = (data?.categories ?? []).filter((c) => !c.parentId || !data?.categories.some((x) => x.id === c.parentId));
  const buyAgain = (data?.buyAgain ?? []).map((id) => byId.get(id)).filter((p): p is StoreProduct => !!p).slice(0, 10);

  const schemeItems: SchemeBannerData[] = data
    ? [
        ...data.banners.map((b) => ({
          id: `b-${b.id}`,
          title: b.title,
          subtitle: b.subtitle,
          imageUrl: b.imageKey ? fileUrl(b.imageKey) : null,
          href: bannerHref(b) ?? undefined,
        })),
        ...data.offers.slice(0, 5).map((o) => ({
          id: `o-${o.id}`,
          kicker: `Scheme${endsLabel(o.endsAt) ? ` · ${endsLabel(o.endsAt)}` : ""}`,
          title: o.summary,
          subtitle: o.name,
          cta: "Add to cart",
          href: `${CATALOGUE}?scheme=${encodeURIComponent(o.id)}`,
        })),
      ]
    : [];

  return (
    <div className="space-y-5">
      {/* 1. Header: next delivery + shop */}
      <header className="flex items-center gap-3">
        <span className="grid place-items-center h-11 w-11 rounded-full bg-[var(--accent-tint)] text-[var(--accent-text)] shrink-0">
          <Icon name="storefront" className="h-6 w-6" weight="duotone" />
        </span>
        <div className="min-w-0">
          {nextDelivery ? (
            <p className="text-[11px] font-extrabold uppercase tracking-[.06em] text-[var(--accent-text)]">Next delivery · {formatDay(nextDelivery)}</p>
          ) : (
            <p className="text-[11px] font-extrabold uppercase tracking-[.06em] text-[var(--muted)]">Welcome</p>
          )}
          <h1 className="font-heading font-bold text-[19px] leading-tight truncate">{shopName}</h1>
          <p className="text-xs text-[var(--muted)] truncate">{area}</p>
        </div>
      </header>

      {/* 2. Search + mic */}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`${CATALOGUE}${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
        }}
      >
        <div className="relative flex-1 min-w-0">
          <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--faint)] pointer-events-none" />
          <input
            className="input !pl-11"
            type="search"
            enterKeyHint="search"
            placeholder="Search “Dove 340ml”, “Sunfeast”…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search products"
          />
        </div>
        {data?.orderText && (
          <Link
            href={`${CATALOGUE}?voice=1`}
            aria-label="Speak or type your order"
            title="Speak or type your order"
            className="grid place-items-center h-12 w-12 shrink-0 rounded-[12px] bg-[var(--accent)] text-[var(--accent-on)]"
          >
            <Icon name="mic" className="h-5 w-5" weight="bold" />
          </Link>
        )}
      </form>

      {/* 3. Khata + credit */}
      {money}

      {!data && !failed && (
        <div className="space-y-4" role="status" aria-label="Loading">
          <Skeleton className="h-[136px] !rounded-[28px]" />
          <div className="grid grid-cols-4 gap-2.5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        </div>
      )}
      {failed && (
        <p className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-semibold flex items-center justify-between gap-3">
          Could not load the catalogue.
          <button type="button" className="btn btn-danger btn-xs" onClick={() => window.location.reload()}>
            Retry
          </button>
        </p>
      )}

      {data && (
        <>
          {/* 4. Scheme banners */}
          {schemeItems.length > 0 && <SchemeCarousel items={schemeItems} />}

          {/* 5. Brand filter + category grid */}
          {data.brands.length > 1 && <BrandFilter brands={data.brands} value={null} onChangeAction={(id) => router.push(id ? `${CATALOGUE}?brand=${encodeURIComponent(id)}` : CATALOGUE)} />}
          {cats.length > 0 && (
            <section className="space-y-2.5" aria-label="Categories">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-heading font-bold text-[16px]">Shop by category</h2>
                <Link href={CATALOGUE} className="text-xs font-bold text-[var(--accent-text)]">
                  All categories
                </Link>
              </div>
              <div className="grid grid-cols-4 gap-x-2.5 gap-y-3">
                {cats.slice(0, 8).map((c, i) => (
                  <Link key={c.id} href={`${CATALOGUE}?category=${encodeURIComponent(c.id)}`} className="i3d-host grid justify-items-center gap-1.5 text-center active:scale-[.97] transition">
                    <span className="grid place-items-center w-full aspect-square rounded-[18px] bg-[var(--surface)] border border-[var(--line)]">
                      <Icon3D name={categoryIcon(c.name)} size={56} tinted animate="tap" priority={i < 4} />
                    </span>
                    <span className="text-[11.5px] font-bold leading-tight line-clamp-2 break-words">{c.name}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* 6. Order again */}
          {buyAgain.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-heading font-bold text-[16px]">Order again</h2>
                <Link href={CATALOGUE} className="text-xs font-bold text-[var(--accent-text)]">
                  Catalogue
                </Link>
              </div>
              <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                {buyAgain.map((p) => (
                  <div key={p.id} data-product-card className="card shrink-0 w-[164px] p-2.5 flex flex-col gap-2">
                    <Link href={`${CATALOGUE}?product=${encodeURIComponent(p.id)}`} className="space-y-1.5 min-w-0">
                      <ProductThumb name={p.name} imageKey={p.images[0]} category={p.category.name} className="h-14 w-14" iconSize={38} />
                      <span className="block text-xs font-semibold leading-snug line-clamp-2">{p.name}</span>
                      <span className="block text-xs text-[var(--muted)] num">
                        {formatINR(p.price)} / {p.unit}
                      </span>
                      <StockChip stock={p.stock} />
                    </Link>
                    <div className="mt-auto">
                      <QtyControl product={p} entry={cart[p.id]} onChangeAction={(e) => setEntry(p.id, e)} compact />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* 7-8. Latest order, announcements, referral, help */}
      {below}

      {/* 9. Cart bar */}
      <CartBar
        count={Object.keys(cart).length}
        total={total}
        onClickAction={() => router.push(`${CATALOGUE}?cart=1`)}
      />
    </div>
  );
}
