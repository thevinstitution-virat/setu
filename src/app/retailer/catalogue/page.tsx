"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import OrderBuilder, { ProductLite } from "@/components/OrderBuilder";

export default function CataloguePage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/products")
      .then((r) => r.json())
      .then((d) => {
        setProducts((d.products ?? []).filter((p: { active: boolean }) => p.active));
        setLoaded(true);
      });
  }, []);

  async function placeOrder(items: { productId: string; quantity: number }[]) {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    router.push(`/retailer/orders/${data.order.id}`);
  }

  return (
    <div>
      <h1 className="page-title mb-4">Catalogue</h1>
      {!loaded ? (
        <p className="text-sm text-foreground/50">Loading…</p>
      ) : (
        <OrderBuilder products={products} onSubmitAction={placeOrder} submitLabel="Place order" />
      )}
    </div>
  );
}
