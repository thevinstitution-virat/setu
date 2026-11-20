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
import {
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
  onPlacedAction,
}: {
  retailerId?: string;
  visitId?: string;
  submitLabel?: string;
  /** Filters to start with (from ?q= ?category= ?brand= ?scheme= ?product=). */
  initial?: StoreFilters;
  /** A WhatsApp order draft to open in "Type or speak your order" (?draft=). */
  draftId?: string | null;
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
  const [reviewOpen, setReviewOpen] = useState(false);

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
          (!schemeOffer || offerCovers(schemeOffer, p))
      ),
    [products, q, category, brand, schemeOffer]
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

  if (loadError) return <p className="text-sm text-[#a8281e]">{loadError}</p>;
  if (!data) return <p className="text-sm text-[var(--muted)]">Loading the catalogue…</p>;

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

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="sticky top-16 z-10 -mt-1 pt-1 pb-2 bg-[rgba(246,241,231,0.85)] backdrop-blur-xl">
        <div className="relative">
          <input
            className="input !pr-10"
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
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-ink/5 text-sm font-bold"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Banners */}
      {!filtering && data.banners.length > 0 && (
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 [scrollbar-width:none]">
          {data.banners.map((b) => (
            <BannerTile key={b.id} banner={b} onOpenAction={() => openBanner(b)} />
          ))}
        </div>
      )}

      {/* Schemes for you */}
      {offers.length > 0 && (
        <section className="space-y-2">
          <p className="page-kick">Schemes for you</p>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
            {offers.map((o) => (
              <button
                key={o.id}
                type="button"
                aria-pressed={scheme === o.id}
                onClick={() => setScheme(scheme === o.id ? null : o.id)}
                className={`chip shrink-0 !py-1.5 ${scheme === o.id ? "chip-mor" : "chip-kesar"}`}
                title={o.name}
              >
                <Icon name="tag" className="h-3.5 w-3.5" />
                {o.summary}
              </button>
            ))}
          </div>
          {schemeOffer && (
            <p className="text-xs text-[var(--ink-2)]">
              <span className="font-bold">{schemeOffer.name}</span>
              {schemeOffer.description ? ` · ${schemeOffer.description}` : ""}
              {!isScoped(schemeOffer) && " · on everything in the catalogue"}
            </p>
          )}
        </section>
      )}

      {/* Type or speak your order (A1) */}
      {(draftId || (!filtering && data.orderText)) && (
        <OrderByText retailerId={retailerId} products={products} byId={byId} inCartAction={(id) => !!cart[id]} draftId={draftId} onAddAction={addFromText} />
      )}

      {/* Usual order (A2) */}
      {!filtering && usual.length > 0 && (
        <section className="card p-3.5 space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="page-kick">Usual order</p>
              <p className="text-xs text-[var(--muted)] mt-0.5">
                What this shop buys most times, from its last {data.usual!.basedOn} orders
              </p>
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
                <span className="shrink-0 tabular-nums text-[var(--muted)]">
                  {u.qty} {u.product.unit}
                  {cart[u.productId] && <span className="ml-1.5 text-[var(--mint-text)] font-semibold">✓</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Buy again */}
      {!filtering && buyAgain.length > 0 && (
        <section className="space-y-2">
          <p className="page-kick">Buy again</p>
          <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none]">
            {buyAgain.map((p) => (
              <div key={p.id} className="card shrink-0 w-[148px] p-2.5 flex flex-col gap-2">
                <button type="button" onClick={() => setOpenProduct(p.id)} className="text-left space-y-1.5 min-w-0">
                  <ProductThumb name={p.name} imageKey={p.images[0]} className={`h-12 w-12 ${p.stock === "out" ? "opacity-60" : ""}`} />
                  <span className="block text-xs font-semibold leading-snug line-clamp-2">{p.name}</span>
                  <span className="block text-xs text-[var(--muted)]">
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

      {/* Categories and brands */}
      {(tops.length > 1 || data.brands.length > 1) && (
        <section className="space-y-2">
          {tops.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              <button type="button" onClick={() => setCategory(null)} className={`chip shrink-0 !py-1.5 ${!category ? "chip-mor" : ""}`}>
                All
              </button>
              {tops.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={activeTop === c.id}
                  onClick={() => setCategory(activeTop === c.id && category === c.id ? null : c.id)}
                  className={`chip shrink-0 !py-1.5 ${activeTop === c.id ? "chip-mor" : ""}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {subs.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {subs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(category === c.id ? activeTop : c.id)}
                  className={`chip shrink-0 !py-1 !text-[12px] ${category === c.id ? "chip-genda" : ""}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {data.brands.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {data.brands.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={brand === b.id}
                  onClick={() => setBrand(brand === b.id ? null : b.id)}
                  className={`chip shrink-0 !py-1 !text-[12px] ${brand === b.id ? "chip-mor" : ""}`}
                >
                  {b.logoKey && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(b.logoKey)} alt="" className="h-4 w-4 rounded object-contain" />
                  )}
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {filtering && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--muted)]">
            {visible.length} product{visible.length === 1 ? "" : "s"}
          </p>
          <button type="button" className="btn btn-quiet btn-xs" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {/* Products */}
      {groups.length === 0 ? (
        <div className="card p-6 text-center text-sm text-[var(--muted)]">
          {products.length === 0 ? "No products to show yet." : "Nothing matches. Try another word or clear the filters."}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="space-y-2">
            <h3 className="page-kick">{g.name}</h3>
            <div className="grid gap-2.5 md:grid-cols-2">
              {g.items.map((p) => (
                <ProductCard
                  key={p.id}
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

      {/* Cart bar */}
      {unitCount > 0 && (
        <>
          <div aria-hidden="true" className="h-24" />
          <div className="fixed bottom-[92px] md:bottom-4 inset-x-3 z-30">
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              className="panel-dark w-full max-w-5xl mx-auto flex items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-xs text-white/70 truncate">
                  {unitCount} item{unitCount === 1 ? "" : "s"}
                  {quote && quote.free.length > 0 && ` · ${quote.free.length} free`}
                  {quote && quote.discountAmount > 0 && ` · saving ${formatINR(quote.discountAmount, { whole: true })}`}
                </span>
                <span className={`block font-heading font-bold text-lg ${fresh ? "" : "opacity-60"}`}>
                  {quote ? formatINR(quote.totalAmount) : "Checking prices…"}
                </span>
                {fresh && quote && quote.shortBy > 0 && (
                  <span className="block text-[11.5px] font-semibold text-genda">Add {formatINR(quote.shortBy)} more to order</span>
                )}
              </span>
              <span className="btn btn-kesar btn-sm shrink-0">
                Review cart <Icon name="arrow" className="h-4 w-4" />
              </span>
            </button>
          </div>
        </>
      )}

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

function BannerTile({ banner: b, onOpenAction }: { banner: Banner; onOpenAction: () => void }) {
  const body = (
    <>
      {b.imageKey && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fileUrl(b.imageKey)} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span className={`absolute inset-0 ${b.imageKey ? "bg-gradient-to-t from-[rgba(8,38,37,0.85)] via-[rgba(8,38,37,0.25)] to-transparent" : ""}`} />
      <span className="relative mt-auto block p-4">
        <span className="block font-heading font-bold text-lg leading-tight text-white">{b.title}</span>
        {b.subtitle && <span className="block text-xs text-white/80 mt-0.5">{b.subtitle}</span>}
      </span>
    </>
  );
  const cls = "panel-dark relative overflow-hidden snap-start shrink-0 w-[85%] sm:w-[360px] h-36 flex flex-col text-left";
  if (b.linkType === "url" && b.linkId && /^https:\/\//i.test(b.linkId)) {
    return (
      <a href={b.linkId} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
      </a>
    );
  }
  if (!b.linkType || !b.linkId) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={onOpenAction} className={cls}>
      {body}
    </button>
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
