"use client";

import { useMemo, useState } from "react";
import { priceBreakup } from "@/lib/orders";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export type ProductLite = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  price: number;
  mrp: number;
  gstRate: number;
  specialOffer?: string | null;
};

export default function OrderBuilder({
  products,
  onSubmitAction,
  submitLabel = "Place order",
}: {
  products: ProductLite[];
  onSubmitAction: (items: { productId: string; quantity: number }[]) => Promise<void>;
  submitLabel?: string;
}) {
  const { t } = useLanguage();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category))), [products]);
  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  const items = Object.entries(cart).filter(([, qty]) => qty > 0);
  const breakup = priceBreakup(
    items.map(([id, qty]) => {
      const p = products.find((pr) => pr.id === id);
      return { quantity: qty, price: p?.price ?? 0, gstRate: p?.gstRate ?? 0 };
    })
  );

  function setQty(id: string, qty: number) {
    setCart((c) => ({ ...c, [id]: Math.max(0, qty) }));
  }

  async function submit() {
    setError(null);
    if (items.length === 0) {
      setError("Add at least one product to the cart");
      return;
    }
    setLoading(true);
    try {
      await onSubmitAction(items.map(([productId, quantity]) => ({ productId, quantity })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 pb-28">
      <input
        className="input"
        placeholder="Search products…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {categories.map((cat) => {
        const inCat = filtered.filter((p) => p.category === cat);
        if (!inCat.length) return null;
        return (
          <div key={cat} className="space-y-2">
            <h3 className="page-kick">
              {cat}
            </h3>
            <div className="space-y-2">
              {inCat.map((p) => (
                <div key={p.id} className="card p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{p.name}</p>
                    <p className="text-xs text-foreground/50">
                      ₹{p.price.toFixed(2)} / {p.unit}
                      {p.mrp > p.price && (
                        <span className="line-through ml-1 text-foreground/30">₹{p.mrp.toFixed(2)}</span>
                      )}
                      {p.gstRate > 0 && <span className="ml-1">· GST {p.gstRate}%</span>}
                    </p>
                    {p.specialOffer && (
                      <p className="text-xs text-[var(--kesar-text)] font-medium mt-0.5">
                        🏷️ {p.specialOffer}
                      </p>
                    )}
                  </div>
                  <QtyStepper value={cart[p.id] ?? 0} onChange={(q) => setQty(p.id, q)} />
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {error && <p className="text-sm text-[#a8281e]">{error}</p>}

      {items.length > 0 && (
        <>
        <div aria-hidden="true" className="h-24" />
        <div className="fixed bottom-[92px] md:bottom-4 inset-x-3 z-30">
          <div className="panel-dark max-w-5xl mx-auto flex items-center justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-xs text-white/70">
                {items.length} item{items.length > 1 ? "s" : ""} · {t("pricing.subtotal")} ₹
                {breakup.subtotal.toFixed(2)}
                {breakup.gstAmount > 0 && (
                  <>
                    {" "}
                    + {t("pricing.gst")} ₹{breakup.gstAmount.toFixed(2)}
                  </>
                )}
              </p>
              <p className="font-heading font-bold text-lg">₹{breakup.totalAmount.toFixed(2)}</p>
            </div>
            <button
              onClick={submit}
              disabled={loading}
              className="btn btn-kesar"
            >
              {loading ? "Placing…" : submitLabel}
            </button>
          </div>
        </div>
        </>
      )}
    </div>
  );
}

function QtyStepper({ value, onChange }: { value: number; onChange: (q: number) => void }) {
  if (value === 0) {
    return (
      <button
        onClick={() => onChange(1)}
        className="btn btn-soft btn-sm"
      >
        Add
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(value - 1)}
        className="h-8 w-8 rounded-lg bg-ink/5 hover:bg-ink/10 font-bold"
      >
        −
      </button>
      <span className="w-5 text-center font-medium">{value}</span>
      <button
        onClick={() => onChange(value + 1)}
        className="h-8 w-8 rounded-lg bg-ink/5 hover:bg-ink/10 font-bold"
      >
        +
      </button>
    </div>
  );
}
