"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CatalogueProduct } from "@/lib/pricing";
import { formatINR } from "@/lib/money";
import { matches } from "@/lib/translit";
import Icon from "@/components/Icon";
import ProductCard from "@/components/store/ProductCard";
import ProductSheet from "@/components/store/ProductSheet";
import CartReview, { type PlaceError } from "@/components/store/CartReview";
import OrderByText, { type TextAdd } from "@/components/store/OrderByText";
import { fileUrl } from "@/components/store/format";
import CartBar from "@/components/ui/CartBar";
import CategoryRail from "@/components/ui/CategoryRail";
import BrandFilter from "@/components/ui/BrandFilter";
import EmptyState from "@/components/ui/EmptyState";
import SchemeCarousel, { type SchemeBannerData } from "@/components/ui/SchemeBanner";
import { ProductCardSkeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import {
  endsLabel,
  isScoped,
  offerCovers,
  ProductThumb,
  QtyControl,
  StockChip,
  type Banner,
  type Cart,
  type CartEntry,
  type CatalogueData,
  type PlacedOrder,
  type QuoteJson,
  type StoreFilters,
  type StoreProduct,
} from "@/components/store/shared";

export type { PlacedOrder, StoreFilters } from "@/components/store/shared";

/**
 * The retailer storefront and cart, used by retailers (no retailerId) and by
 * sales agents ordering for a retailer. Products, rates, schemes and cart
 * rules come from GET /api/catalogue; every cart change is priced by POST
 * /api/cart/quote (debounced) and the order is placed with the same items.
 * The client never computes or sends a price.
 */
export default function Storefront({
  retailerId,
  visitId,
  submitLabel = "Place order",
  initial,
  draftId,
  openVoice = false,
  openCart = false,
  onPlacedAction,
}: {
  retailerId?: string;
  visitId?: string;
  submitLabel?: string;
  /** Filters to start with (from ?q= ?category= ?brand= ?scheme= ?product=). */
  initial?: StoreFilters;
  /** A WhatsApp order draft to open in "Type or speak your order" (?draft=). */
  draftId?: string | null;
  /** Start with "Type or speak your order" open (?voice=1). */
  openVoice?: boolean;
  /** Start with the cart review open (?cart=1, from the home cart bar). */
  openCart?: boolean;
  onPlacedAction: (order: PlacedOrder) => void;
}) {
  const [data, setData] = useState<CatalogueData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [cart, setCart] = useState<Cart>({});
  const [coupon, setCoupon] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<string | null>(null);

  const [q, setQ] = useState(initial?.q ?? "");
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
  const [brand, setBrand] = useState<string | null>(initial?.brand ?? null);
  const [scheme, setScheme] = useState<string | null>(initial?.scheme ?? null);
  const [openProduct, setOpenProduct] = useState<string | null>(initial?.product ?? null);
  const [reviewOpen, setReviewOpen] = useState(openCart);
  const [schemeOnly, setSchemeOnly] = useState(false);
  const [inStock, setInStock] = useState(false);
  const [voiceKey, setVoiceKey] = useState(openVoice ? 1 : 0);
  const [view, setView] = useState<"grid" | "list">(() => {
    try {
      return localStorage.getItem("vbiz:view") === "list" ? "list" : "grid";
    } catch {
      return "grid";
    }
  });
  const changeView = (v: "grid" | "list") => {
    setView(v);
    try {
      localStorage.setItem("vbiz:view", v);
    } catch {
      // storage blocked: the choice just won't be remembered
    }
  };

  const [quoted, setQuoted] = useState<{ key: string; quote: QuoteJson } | null>(null);
  const [quoteError, setQuoteError] = useState<{ key: string; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<PlaceError | null>(null);
  /** The WhatsApp draft the cart came from: placing the order uses it up. */
  const [fromDraft, setFromDraft] = useState<string | null>(null);

  const draftKey = data ? `setu:cart:${data.retailer.id}` : null;
  const restored = useRef(false);

  // ── load the catalogue, then restore the draft cart ──
  useEffect(() => {
    let live = true;
    restored.current = false;
    fetch(`/api/catalogue${retailerId ? `?retailerId=${encodeURIComponent(retailerId)}` : ""}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "Could not load the catalogue");
        return d as CatalogueData;
      })
      .then((d) => {
        if (!live) return;
        const byId = new Map(d.products.map((p) => [p.id, p]));
        const draft = readDraft(`setu:cart:${d.retailer.id}`);
        const next: Cart = {};
        for (const [id, e] of Object.entries(draft?.cart ?? {})) {
          const p = byId.get(id);
          if (!p || !e || !Number.isInteger(e.qty) || e.qty < 1) continue;
          next[id] = { qty: e.qty, mode: e.mode === "cases" && p.caseSize ? "cases" : "units" };
        }
        setData(d);
        setCart(next);
        setCoupon(typeof draft?.coupon === "string" ? draft.coupon : "");
        setNotes(typeof draft?.notes === "string" ? draft.notes : "");
        restored.current = true;
      })
      .catch((e: unknown) => live && setLoadError(e instanceof Error ? e.message : "Could not load the catalogue"));
    return () => {
      live = false;
    };
  }, [retailerId]);

  // ── keep the draft ──
  useEffect(() => {
    if (!draftKey || !restored.current) return;
    try {
      if (!Object.keys(cart).length && !coupon && !notes) localStorage.removeItem(draftKey);
      else localStorage.setItem(draftKey, JSON.stringify({ cart, coupon, notes }));
    } catch {
      // storage blocked or full: the cart just won't survive a reload
    }
  }, [draftKey, cart, coupon, notes]);

  const products = useMemo(() => data?.products ?? [], [data]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // ── what we ask the server to price ──
  const items = useMemo(
    () =>
      Object.entries(cart)
        .filter(([id]) => byId.has(id))
        .map(([productId, e]) => (e.mode === "cases" ? { productId, cases: e.qty } : { productId, quantity: e.qty })),
    [cart, byId]
  );
  const sendDate = data?.cart.allowDateChoice ? deliveryDate : null;
  const key = JSON.stringify({ items, coupon, d: sendDate, n: nonce });

  useEffect(() => {
    if (!items.length) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/cart/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retailerId, items, coupon: coupon || undefined, deliveryDate: sendDate ?? undefined }),
          signal: ctrl.signal,
        });
        const d = await res.json().catch(() => ({}));
        if (ctrl.signal.aborted) return;
        if (!res.ok) return setQuoteError({ key, message: d.error ?? "Could not check prices. Try again." });
        setQuoted({ key, quote: d.quote as QuoteJson });
        setQuoteError(null);
      } catch {
        if (!ctrl.signal.aborted) setQuoteError({ key, message: "Network error while checking prices." });
      }
    }, 300);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key, items, coupon, sendDate, retailerId]);

  const quote = items.length ? (quoted?.quote ?? null) : null;
  const fresh = !!quoted && quoted.key === key && items.length > 0;
  const qError = quoteError && quoteError.key === key ? quoteError.message : null;

  // "Scheme applied": once per scheme per visit, when the server prices a scheme into the cart.
  const seenSchemes = useRef(new Set<string>());
  useEffect(() => {
    if (!fresh || !quote) return;
    const fresh2 = quote.applied.filter((a) => !seenSchemes.current.has(a.schemeId));
    if (!fresh2.length) return;
    fresh2.forEach((a) => seenSchemes.current.add(a.schemeId));
    toast(`Scheme applied: ${fresh2[0].name}`);
  }, [fresh, quote]);

  const setEntry = useCallback((id: string, e: CartEntry | null) => {
    setPlaceError(null);
    setCart((c) => {
      const next = { ...c };
      if (e) next[id] = e;
      else delete next[id];
      return next;
    });
  }, []);

  async function place() {
    if (!fresh || !quote || quote.problems.length || placing) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retailerId,
          items,
          coupon: coupon || undefined,
          deliveryDate: sendDate ?? undefined,
          notes: notes.trim() || undefined,
          visitId,
          draftId: fromDraft ?? undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPlaceError({ status: res.status, message: d.error ?? "Could not place the order. Try again." });
        if (res.status === 409) setNonce((n) => n + 1); // a scheme ran out / credit: price again
        return;
      }
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
      }
      setCart({});
      setFromDraft(null);
      setCoupon("");
      setNotes("");
      setReviewOpen(false);
      onPlacedAction(d.order as PlacedOrder);
    } catch {
      setPlaceError({ status: 0, message: "Network error. Check your connection and try again." });
    } finally {
      setPlacing(false);
    }
  }

  // ── filters ──
  const offers = useMemo(() => data?.offers ?? [], [data]);
  const schemeOffer = scheme ? (offers.find((o) => o.id === scheme) ?? null) : null;
  const filtering = !!(q.trim() || category || brand || schemeOffer);

  const visible = useMemo(
    () =>
      products.filter(
        (p) =>
          (!q.trim() || matches(p.search, q)) &&
          (!category || p.categoryPath.includes(category)) &&
          (!brand || p.brand?.id === brand) &&
          (!schemeOffer || offerCovers(schemeOffer, p)) &&
          (!schemeOnly || !!p.specialOffer || offers.some((o) => isScoped(o) && offerCovers(o, p))) &&
          (!inStock || p.stock !== "out")
      ),
    [products, q, category, brand, schemeOffer, schemeOnly, inStock, offers]
  );

  const categories = useMemo(() => data?.categories ?? [], [data]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const rootOf = (id: string | null) => {
    let c = id ? catById.get(id) : undefined;
    let guard = 0;
    while (c?.parentId && catById.has(c.parentId) && guard++ < 10) c = catById.get(c.parentId);
    return c?.id ?? null;
  };
  const tops = categories.filter((c) => !c.parentId || !catById.has(c.parentId));
  const activeTop = rootOf(category);
  const subs = activeTop ? categories.filter((c) => c.parentId === activeTop) : [];

  const groups = useMemo(() => {
    const order = new Map(categories.map((c, i) => [c.id, i]));
    const m = new Map<string, { name: string; items: StoreProduct[] }>();
    for (const p of visible) {
      const g = m.get(p.category.id) ?? { name: p.category.name, items: [] };
      g.items.push(p);
      m.set(p.category.id, g);
    }
    return [...m.entries()].sort((a, b) => (order.get(a[0]) ?? 1e9) - (order.get(b[0]) ?? 1e9)).map(([id, g]) => ({ id, ...g }));
  }, [visible, categories]);

  const cardOffers = useCallback((p: CatalogueProduct) => offers.filter((o) => isScoped(o) && offerCovers(o, p)), [offers]);

  function clearFilters() {
    setQ("");
    setCategory(null);
    setBrand(null);
    setScheme(null);
  }

  function openBanner(b: Banner) {
    if (!b.linkId) return;
    if (b.linkType === "product" && byId.has(b.linkId)) setOpenProduct(b.linkId);
    else if (b.linkType === "brand") {
      clearFilters();
      setBrand(b.linkId);
    } else if (b.linkType === "category") {
      clearFilters();
      setCategory(b.linkId);
    } else if (b.linkType === "scheme") {
      clearFilters();
      setScheme(b.linkId);
    }
  }

  if (loadError)
    return (
      <div className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-semibold flex items-center justify-between gap-3">
        {loadError}
        <button type="button" className="btn btn-danger btn-xs" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  if (!data)
    return (
      <div className="space-y-4" role="status" aria-label="Loading the catalogue">
        <div className="skeleton h-12" />
        <div className="skeleton h-[136px] !rounded-[28px]" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
          {Array.from({ length: 6 }, (_, i) => (
            <ProductCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );

  const cartIds = Object.keys(cart);
  const unitCount = cartIds.length;
  const sheetProduct = openProduct ? (byId.get(openProduct) ?? null) : null;
  const buyAgain = data.buyAgain.map((id) => byId.get(id)).filter((p): p is StoreProduct => !!p);
  const usual = (data.usual?.lines ?? []).flatMap((l) => {
    const p = byId.get(l.productId);
    return p && p.stock !== "out" ? [{ ...l, product: p }] : [];
  });
  const usualMissing = usual.filter((u) => !cart[u.productId]);
  function addUsual() {
    for (const u of usualMissing) setEntry(u.productId, { qty: u.qty, mode: "units" });
  }
  /** From "Type or speak your order": adds to what is in the cart (same units), else sets it. */
  function addFromText(adds: TextAdd[], draft: string | null) {
    setPlaceError(null);
    setCart((c) => {
      const next = { ...c };
      for (const a of adds) {
        const had = next[a.productId];
        next[a.productId] = had && had.mode === a.entry.mode ? { ...had, qty: had.qty + a.entry.qty } : a.entry;
      }
      return next;
    });
    if (draft) setFromDraft(draft);
  }

  const schemeItems: SchemeBannerData[] = [
    ...data.banners.map((b) => ({
      id: `b-${b.id}`,
      title: b.title,
      subtitle: b.subtitle,
      imageUrl: b.imageKey ? fileUrl(b.imageKey) : null,
      onClickAction: b.linkType && b.linkId ? () => openBanner(b) : undefined,
    })),
    ...offers.slice(0, 5).map((o) => ({
      id: `o-${o.id}`,
      kicker: `Scheme${endsLabel(o.endsAt) ? ` · ${endsLabel(o.endsAt)}` : ""}`,
      title: o.summary,
      subtitle: o.name,
      cta: "Show products",
      onClickAction: () => setScheme(o.id),
    })),
  ];

  const cartNote = [quote && quote.free.length > 0 ? `${quote.free.length} free` : "", quote && quote.discountAmount > 0 ? `saving ${formatINR(quote.discountAmount, { whole: true })}` : ""]
    .filter(Boolean)
    .join(" · ");

  const grid = view === "grid";
  const listCls = grid ? "grid gap-2.5 grid-cols-2 md:grid-cols-3 2xl:grid-cols-4" : "grid gap-2.5 md:grid-cols-2";

  return (
    <div className="space-y-4">
      {/* Search + mic */}
      <div className="sticky top-16 z-10 -mx-4 px-4 md:-mx-6 md:px-6 lg:-mx-8 lg:px-8 pt-1 pb-2 bg-[color-mix(in_srgb,var(--canvas)_92%,transparent)] backdrop-blur-xl">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <Icon name="search" className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--faint)] pointer-events-none" />
            <input
              className="input !pl-11 !pr-10"
              type="text"
              enterKeyHint="search"
              placeholder="Search products, brands… (Hindi or English)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search products"
            />
            {q && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center h-8 w-8 rounded-full bg-[var(--surface-2)]"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            )}
          </div>
          {data.orderText && (
            <button
              type="button"
              aria-label="Speak or type your order"
              title="Speak or type your order"
              onClick={() => {
                setVoiceKey((k) => k + 1);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="grid place-items-center h-12 w-12 shrink-0 rounded-[12px] bg-[var(--accent)] text-[var(--accent-on)]"
            >
              <Icon name="mic" className="h-5 w-5" weight="bold" />
            </button>
          )}
        </div>
      </div>

      {/* Scheme banners (business banners first, then live offers) */}
      {!filtering && schemeItems.length > 0 && <SchemeCarousel items={schemeItems} />}

      {schemeOffer && (
        <div className="flex items-center gap-2 rounded-[14px] bg-[var(--scheme-tint)] text-[var(--scheme-text)] px-3 py-2 text-sm">
          <Icon name="tag" className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="font-bold">{schemeOffer.name}</span>
            {schemeOffer.description ? ` · ${schemeOffer.description}` : ""}
            {!isScoped(schemeOffer) && " · on everything in the catalogue"}
          </span>
          <button type="button" aria-label="Clear scheme" className="grid place-items-center h-8 w-8 rounded-full bg-white/70" onClick={() => setScheme(null)}>
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Type or speak your order (A1) */}
      {(draftId || (!filtering && data.orderText)) && (
        <OrderByText
          key={voiceKey}
          defaultOpen={voiceKey > 0}
          retailerId={retailerId}
          products={products}
          byId={byId}
          inCartAction={(id) => !!cart[id]}
          draftId={draftId}
          onAddAction={addFromText}
        />
      )}

      {/* Usual order (A2) */}
      {!filtering && usual.length > 0 && (
        <section className="card p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="page-kick">Usual order</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">What this shop buys most times, from its last {data.usual!.basedOn} orders</p>
            </div>
            <button type="button" className="btn btn-primary btn-sm shrink-0" disabled={!usualMissing.length} onClick={addUsual}>
              {usualMissing.length ? `Add ${usualMissing.length} to cart` : "All in cart"}
            </button>
          </div>
          <ul className="text-sm divide-y divide-[var(--line)]">
            {usual.map((u) => (
              <li key={u.productId} className="flex items-center justify-between gap-3 py-1.5">
                <button type="button" className="min-w-0 truncate text-left" onClick={() => setOpenProduct(u.productId)}>
                  {u.product.name}
                </button>
                <span className="shrink-0 num text-[var(--muted)]">
                  {u.qty} {u.product.unit}
                  {cart[u.productId] && <span className="ml-1.5 text-[var(--success-text)] font-semibold">✓</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Buy again */}
      {!filtering && buyAgain.length > 0 && (
        <section className="space-y-2">
          <p className="page-kick">Order again</p>
          <div className="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
            {buyAgain.map((p) => (
              <div key={p.id} data-product-card className="card shrink-0 w-[164px] p-2.5 flex flex-col gap-2">
                <button type="button" onClick={() => setOpenProduct(p.id)} className="text-left space-y-1.5 min-w-0">
                  <ProductThumb
                    name={p.name}
                    imageKey={p.images[0]}
                    category={p.category.name}
                    className={`h-14 w-14 ${p.stock === "out" ? "opacity-60" : ""}`}
                    iconSize={38}
                  />
                  <span className="block text-xs font-semibold leading-snug line-clamp-2">{p.name}</span>
                  <span className="block text-xs text-[var(--muted)] num">
                    {formatINR(p.price)} / {p.unit}
                  </span>
                  <StockChip stock={p.stock} />
                </button>
                <div className="mt-auto flex justify-end">
                  <QtyControl product={p} entry={cart[p.id]} onChangeAction={(e) => setEntry(p.id, e)} compact />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Brand filter, sticky chips */}
      {data.brands.length > 1 && <BrandFilter brands={data.brands} value={brand} onChangeAction={setBrand} param="brand" />}

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          type="button"
          aria-pressed={schemeOnly}
          onClick={() => setSchemeOnly((v) => !v)}
          className={`chip shrink-0 min-h-10 !px-3.5 ${schemeOnly ? "chip-scheme" : ""}`}
        >
          <Icon name="tag" className="h-4 w-4" /> Scheme only
        </button>
        <button type="button" aria-pressed={inStock} onClick={() => setInStock((v) => !v)} className={`chip shrink-0 min-h-10 !px-3.5 ${inStock ? "chip-mint" : ""}`}>
          <Icon name="check" className="h-4 w-4" /> In stock
        </button>
        <span className="flex-1" />
        <div className="seg shrink-0" role="group" aria-label="View">
          <button type="button" aria-pressed={grid} className={grid ? "is-on" : ""} onClick={() => changeView("grid")} aria-label="Grid view">
            <Icon name="grid" className="h-4 w-4" />
          </button>
          <button type="button" aria-pressed={!grid} className={!grid ? "is-on" : ""} onClick={() => changeView("list")} aria-label="List view">
            <Icon name="menu" className="h-4 w-4" />
          </button>
        </div>
      </div>

      {(filtering || schemeOnly || inStock) && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">
            {visible.length} product{visible.length === 1 ? "" : "s"}
          </p>
          <button
            type="button"
            className="btn btn-quiet btn-xs"
            onClick={() => {
              clearFilters();
              setSchemeOnly(false);
              setInStock(false);
            }}
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Category rail + products */}
      <div className={tops.length > 1 ? "grid grid-cols-[76px_minmax(0,1fr)] gap-3 items-start" : ""}>
        {tops.length > 1 && (
          <aside className="sticky top-36 max-h-[calc(100dvh-10rem)] overflow-y-auto no-scrollbar pr-2 -mr-2">
            <CategoryRail items={tops} value={activeTop} onChangeAction={(id) => setCategory(id)} />
          </aside>
        )}
        <div className="space-y-4 min-w-0">
          {subs.length > 0 && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {subs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(category === c.id ? activeTop : c.id)}
                  className={`chip shrink-0 min-h-9 ${category === c.id ? "chip-kesar" : ""}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {groups.length === 0 ? (
            products.length === 0 ? (
              <EmptyState icon="empty-cart" title="No products yet" text="Your distributor has not added any products to your catalogue." />
            ) : (
              <EmptyState
                icon="no-results"
                title="Nothing matches"
                text="Try another word or clear the filters."
                action={{
                  label: "Clear filters",
                  onClick: () => {
                    clearFilters();
                    setSchemeOnly(false);
                    setInStock(false);
                  },
                }}
              />
            )
          ) : (
            groups.map((g) => (
              <section key={g.id} className="space-y-2">
                <h3 className="page-kick">{g.name}</h3>
                <div className={listCls}>
                  {g.items.map((p) => (
                    <ProductCard
                      key={p.id}
                      variant={view}
                      product={p}
                      offers={cardOffers(p)}
                      entry={cart[p.id]}
                      onChangeAction={(e) => setEntry(p.id, e)}
                      onOpenAction={() => setOpenProduct(p.id)}
                    />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      <CartBar
        count={unitCount}
        total={quote ? quote.totalAmount : null}
        stale={!fresh}
        note={cartNote}
        warn={fresh && quote && quote.shortBy > 0 ? `Add ${formatINR(quote.shortBy)} more to order` : null}
        onClickAction={() => setReviewOpen(true)}
      />

      <ProductSheet
        product={sheetProduct}
        offers={sheetProduct ? offers.filter((o) => offerCovers(o, sheetProduct)) : []}
        entry={sheetProduct ? cart[sheetProduct.id] : undefined}
        priceList={data.retailer.priceList}
        lineTotal={sheetProduct && fresh ? (quote?.lines.find((l) => l.productId === sheetProduct.id)?.total ?? null) : null}
        onChangeAction={(e) => sheetProduct && setEntry(sheetProduct.id, e)}
        onCloseAction={() => setOpenProduct(null)}
      />

      <CartReview
        open={reviewOpen}
        cart={cart}
        products={byId}
        rules={data.cart}
        quote={quote}
        fresh={fresh}
        quoteError={qError}
        coupon={coupon}
        deliveryDate={sendDate}
        notes={notes}
        placing={placing}
        placeError={placeError}
        forRetailer={!retailerId}
        submitLabel={submitLabel}
        onCloseAction={() => setReviewOpen(false)}
        onEntryAction={setEntry}
        onCouponAction={(c) => {
          setPlaceError(null);
          setCoupon(c);
        }}
        onDateAction={(d) => {
          setPlaceError(null);
          setDeliveryDate(d);
        }}
        onNotesAction={setNotes}
        onPlaceAction={place}
        onRetryAction={() => setNonce((n) => n + 1)}
      />
    </div>
  );
}

type Draft = { cart?: Record<string, { qty: number; mode: string }>; coupon?: unknown; notes?: unknown };
function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && typeof d === "object" ? d : null;
  } catch {
    return null;
  }
}
