"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Storefront from "@/components/Storefront";

export default function CataloguePage() {
  return (
    <div>
      <h1 className="page-title mb-4">Catalogue</h1>
      <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
        <Catalogue />
      </Suspense>
    </div>
  );
}

/** ?q= ?category= ?brand= ?scheme= ?product= (links from the home page) set the starting filters. */
function Catalogue() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = {
    q: params.get("q"),
    category: params.get("category"),
    brand: params.get("brand"),
    scheme: params.get("scheme"),
    product: params.get("product"),
  };
  return (
    <Storefront
      key={params.toString()}
      initial={initial}
      draftId={params.get("draft")}
      openVoice={params.get("voice") === "1"}
      openCart={params.get("cart") === "1"}
      submitLabel="Place order"
      onPlacedAction={(order) => router.push(`/retailer/orders/${order.id}`)}
    />
  );
}
