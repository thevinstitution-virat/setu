"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Storefront, { type PlacedOrder } from "@/components/Storefront";
import OrderPlaced from "@/components/ui/OrderPlaced";

export default function CataloguePage() {
  return (
    <div>
      <h1 className="page-title mb-4">Catalogue</h1>
      <Suspense fallback={<div className="skeleton h-12" role="status" aria-label="Loading" />}>
        <Catalogue />
      </Suspense>
    </div>
  );
}

/** ?q= ?category= ?brand= ?scheme= ?product= (links from the home page) set the starting filters. */
function Catalogue() {
  const router = useRouter();
  const params = useSearchParams();
  const [placed, setPlaced] = useState<PlacedOrder | null>(null);
  const initial = {
    q: params.get("q"),
    category: params.get("category"),
    brand: params.get("brand"),
    scheme: params.get("scheme"),
    product: params.get("product"),
  };
  return (
    <>
      <Storefront
        key={params.toString()}
        initial={initial}
        draftId={params.get("draft")}
        openVoice={params.get("voice") === "1"}
        openCart={params.get("cart") === "1"}
        submitLabel="Place order"
        onPlacedAction={(order) => {
          setPlaced(order);
          window.setTimeout(() => router.push(`/retailer/orders/${order.id}`), 1700);
        }}
      />
      {placed && <OrderPlaced orderNumber={placed.orderNumber} />}
    </>
  );
}
