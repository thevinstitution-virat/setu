"use client";

import { useEffect, useState } from "react";
import { formatINR, toPaise } from "@/lib/money";

type Product = {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  price: number;
  mrp: number;
  gstRate: number;
  specialOffer: string | null;
  active: boolean;
};

const GST_SLABS = [0, 5, 12, 18, 28];

const empty = {
  name: "",
  sku: "",
  category: "",
  unit: "pc",
  price: "",
  mrp: "",
  gstRate: "0",
  specialOffer: "",
};

export default function AdminProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const d = await fetch("/api/products").then((r) => r.json());
    setProducts(d.products ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function addProduct() {
    setError(null);
    if (!form.name || !form.sku || !form.category || !form.price || !form.mrp) {
      setError("Fill in all fields");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          price: toPaise(form.price),
          mrp: toPaise(form.mrp),
          specialOffer: form.specialOffer || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setForm(empty);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(p: Product) {
    await fetch(`/api/products/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !p.active }),
    });
    await load();
  }

  return (
    <div className="space-y-6">
      <h1 className="page-title">Products</h1>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold">Add product</p>
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          <input className="input" placeholder="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className="input" placeholder="Unit (e.g. pc, box)" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <input className="input" placeholder="Price (₹)" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
          <input className="input" placeholder="MRP (₹)" inputMode="decimal" value={form.mrp} onChange={(e) => setForm({ ...form, mrp: e.target.value })} />
          <select className="input" value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })}>
            {GST_SLABS.map((g) => (
              <option key={g} value={g}>
                GST {g}%
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Special offer (optional, e.g. Flat 5% off)"
            value={form.specialOffer}
            onChange={(e) => setForm({ ...form, specialOffer: e.target.value })}
          />
        </div>
        {error && <p className="text-sm text-[#a8281e]">{error}</p>}
        <button
          onClick={addProduct}
          disabled={loading}
          className="btn btn-kesar btn-sm"
        >
          {loading ? "Adding…" : "Add product"}
        </button>
      </div>

      <div className="space-y-2">
        {products.map((p) => (
          <div key={p.id} className="card p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{p.name}</p>
              <p className="text-xs text-foreground/50">
                {p.sku} · {p.category} · {formatINR(p.price)} / {p.unit} · GST {p.gstRate}%
              </p>
              {p.specialOffer && (
                <p className="text-xs text-[var(--kesar-text)] font-medium">🏷️ {p.specialOffer}</p>
              )}
            </div>
            <button
              onClick={() => toggleActive(p)}
              className={`shrink-0 text-xs font-medium rounded-lg px-3 py-1.5 ${
                p.active ? "bg-[var(--mint-tint)] text-[var(--mint-text)] font-bold" : "bg-black/5 text-foreground/50"
              }`}
            >
              {p.active ? "Active" : "Inactive"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
