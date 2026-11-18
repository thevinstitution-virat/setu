"use client";

import { useEffect, useState, use as usePromise } from "react";
import { formatINR } from "@/lib/money";
import { useRouter } from "next/navigation";
import SignaturePad from "@/components/SignaturePad";
import { getLocation } from "@/lib/geo";
import { compressImage, dataUrlToBlob, uploadFile } from "@/lib/upload-client";

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  retailer: { outletName: string; shopNumber: string; complexName: string; user: { phone: string | null } };
  items: { id: string; quantity: number; price: number; product: { name: string } }[];
};

export default function DeliverOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "ONLINE" | "CREDIT">("CASH");
  const [signature, setSignature] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then((r) => r.json())
      .then((d) => setOrder(d.order));
  }, [id]);

  function handlePhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function complete() {
    setError(null);
    setLoading(true);
    try {
      // Photos go to file storage; the order keeps only the storage keys.
      const [loc, photoKey, signatureKey] = await Promise.all([
        getLocation(),
        photoFile ? compressImage(photoFile).then((b) => uploadFile(b, "pod-photo")) : null,
        signature ? uploadFile(dataUrlToBlob(signature), "pod-signature") : null,
      ]);
      const res = await fetch(`/api/orders/${id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          podPhotoKey: photoKey,
          podSignatureKey: signatureKey,
          ...loc,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      router.push("/delivery");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!order) return <p className="text-sm text-foreground/50">Loading…</p>;

  if (order.status === "DELIVERED") {
    return <p className="text-sm text-[var(--mint-text)] font-medium">This order has already been delivered.</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">{order.retailer.outletName}</h1>
        <p className="text-sm text-foreground/50">
          Shop {order.retailer.shopNumber}, {order.retailer.complexName}
        </p>
        {order.retailer.user.phone && (
          <p className="text-sm text-foreground/50">📞 {order.retailer.user.phone}</p>
        )}
      </div>

      <div className="card p-4">
        <p className="text-sm font-semibold mb-2">{order.orderNumber}</p>
        <div className="space-y-1">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>
                {item.product.name} × {item.quantity}
              </span>
              <span>{formatINR(item.price * item.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-black/5 mt-2 pt-2 flex justify-between font-semibold text-sm">
          <span>Total</span>
          <span>{formatINR(order.totalAmount)}</span>
        </div>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold">Payment collection</p>
        <div className="flex gap-2">
          {(["CASH", "ONLINE", "CREDIT"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setPaymentMethod(m)}
              className={`flex-1 rounded-xl py-2 text-sm font-medium ${
                paymentMethod === m ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/70"
              }`}
            >
              {m === "CASH" ? "Cash" : m === "ONLINE" ? "Online" : "Credit"}
            </button>
          ))}
        </div>
        {paymentMethod === "CASH" && (
          <p className="text-sm text-foreground/60">Collect {formatINR(order.totalAmount)} in cash.</p>
        )}
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold">Proof of delivery</p>
        <SignaturePad onChangeAction={setSignature} />
        <label className="block">
          <span className="text-xs text-foreground/50">Delivery photo (optional)</span>
          <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} className="block text-sm mt-1" />
        </label>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo} alt="Proof of delivery" className="rounded-lg max-h-32" />
        )}
      </div>

      {error && <p className="text-sm text-[#a8281e]">{error}</p>}

      <button
        onClick={complete}
        disabled={loading}
        className="btn btn-kesar w-full"
      >
        {loading ? "Completing…" : "Mark delivered"}
      </button>
    </div>
  );
}
