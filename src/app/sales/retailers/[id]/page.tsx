"use client";

import { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import OrderBuilder, { ProductLite } from "@/components/OrderBuilder";
import { STATUS_COLOR } from "@/lib/orders";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { OrderStatus as OrderStatusKey } from "@/generated/prisma/client";

type RetailerDetail = {
  id: string;
  outletName: string;
  shopNumber: string;
  complexName: string;
  pinCode: string;
  user: { phone: string | null };
  area: { name: string };
  orders: {
    id: string;
    orderNumber: string;
    status: OrderStatusKey;
    totalAmount: number;
    createdAt: string;
    items: unknown[];
  }[];
  visits: { id: string; checkInAt: string; checkOutAt: string | null }[];
};

export default function RetailerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = usePromise(params);
  const router = useRouter();
  const { t } = useLanguage();
  const [retailer, setRetailer] = useState<RetailerDetail | null>(null);
  const [products, setProducts] = useState<ProductLite[]>([]);
  const [showOrder, setShowOrder] = useState(false);

  async function load() {
    const d = await fetch(`/api/sales/retailers/${id}`).then((r) => r.json());
    setRetailer(d.retailer);
    setProducts(d.products ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function placeOrder(items: { productId: string; quantity: number }[]) {
    const openVisit = retailer?.visits.find((v) => !v.checkOutAt);
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, retailerId: id, visitId: openVisit?.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    router.push(`/sales/orders`);
  }

  async function checkOutVisit(visitId: string) {
    await fetch(`/api/visits/${visitId}/checkout`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
    await load();
  }

  if (!retailer) return <p className="text-sm text-foreground/50">Loading…</p>;

  const openVisit = retailer.visits.find((v) => !v.checkOutAt);

  if (showOrder) {
    return (
      <div>
        <button className="text-sm text-[var(--kesar-text)] mb-3" onClick={() => setShowOrder(false)}>
          ← Back to {retailer.outletName}
        </button>
        <OrderBuilder products={products} onSubmitAction={placeOrder} submitLabel="Place order for retailer" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">{retailer.outletName}</h1>
        <p className="text-sm text-foreground/50">
          Shop {retailer.shopNumber}, {retailer.complexName} · {retailer.area.name}
        </p>
        {retailer.user.phone && (
          <p className="text-sm text-foreground/50">📞 {retailer.user.phone}</p>
        )}
      </div>

      {openVisit && (
        <div className="card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-foreground/50">Visit in progress</p>
            <p className="text-sm font-medium">
              Checked in {new Date(openVisit.checkInAt).toLocaleTimeString()}
            </p>
          </div>
          <button
            onClick={() => checkOutVisit(openVisit.id)}
            className="btn btn-quiet btn-sm"
          >
            Check out
          </button>
        </div>
      )}

      <button
        onClick={() => setShowOrder(true)}
        className="btn btn-kesar w-full"
      >
        Capture order
      </button>

      <div>
        <p className="text-sm font-semibold mb-2">Recent orders</p>
        <div className="space-y-2">
          {retailer.orders.map((o) => (
            <div key={o.id} className="card p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{o.orderNumber}</p>
                <p className="text-xs text-foreground/50">
                  {new Date(o.createdAt).toLocaleDateString()} · ₹{o.totalAmount.toFixed(2)}
                </p>
              </div>
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
                {t(`status.${o.status}`)}
              </span>
            </div>
          ))}
          {retailer.orders.length === 0 && (
            <p className="text-sm text-foreground/50">No orders yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
