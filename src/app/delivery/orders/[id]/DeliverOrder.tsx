"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";
import { useRouter } from "next/navigation";
import SignaturePad from "@/components/SignaturePad";
import { getLocation } from "@/lib/geo";
import { compressImage, dataUrlToBlob, uploadFile } from "@/lib/upload-client";
import Icon from "@/components/Icon";
import OrderLines, { type OrderLineItem } from "@/components/store/OrderLines";
import PaymentFields, { emptyPayment, paymentError, toCollectBody, type PaymentValue } from "@/components/PaymentFields";
import DeliveryInvoiceCard, { type DeliveryInvoice } from "./DeliveryInvoiceCard";

type Dues = { balances: { receivable: number }; overdue: number; openBills?: { orderId: string | null; due: number }[] };

type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  grossAmount: number;
  discountAmount: number;
  deliveryCharge: number;
  subtotal: number;
  gstAmount: number;
  couponCode: string | null;
  deliveryDate: string | null;
  notes: string | null;
  retailerId: string;
  /** Paise reserved from the retailer's wallet (prepaid); paid automatically on delivery. */
  walletHold: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  creditApprovedAt: string | null;
  retailer: { outletName: string; shopNumber: string; complexName: string; user: { phone: string | null } };
  items: OrderLineItem[];
};

/** `invoices`: documents already issued for this order (loaded by the server page; refreshed after delivery). */
export default function DeliverOrder({ id, invoices }: { id: string; invoices: DeliveryInvoice[] }) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [pay, setPay] = useState<PaymentValue>(() => emptyPayment(undefined, null));
  const [dues, setDues] = useState<Dues | null>(null);
  const [duesError, setDuesError] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then((r) => r.json())
      .then((d: { order?: OrderDetail }) => {
        const o = d.order;
        if (!o) return;
        setOrder(o);
        // Prepaid orders are paid from the wallet on delivery: nothing to collect by default.
        setPay(o.walletHold > 0 ? emptyPayment(undefined, null) : emptyPayment(o.totalAmount, "CASH"));
        fetch(`/api/admin/khata/${o.retailerId}`)
          .then(async (r) => (r.ok ? setDues(await r.json()) : setDuesError(true)))
          .catch(() => setDuesError(true));
      });
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
    const bad = paymentError(pay);
    if (bad) return setError(bad);
    setLoading(true);
    try {
      // Photos go to file storage; the order keeps only the storage keys.
      const [loc, photoKey, signatureKey, collect] = await Promise.all([
        getLocation(),
        photoFile ? compressImage(photoFile).then((b) => uploadFile(b, "pod-photo")) : null,
        signature ? uploadFile(dataUrlToBlob(signature), "pod-signature") : null,
        toCollectBody(pay),
      ]);
      const res = await fetch(`/api/orders/${id}/deliver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // No `collect` = delivered on credit (or paid from the wallet).
          ...(collect ? { collect } : {}),
          podPhotoKey: photoKey,
          podSignatureKey: signatureKey,
          ...loc,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Stay here: the invoice (issued at dispatch or just now) can be shared straight away.
      setOrder({ ...order!, status: "DELIVERED" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!order) return <p className="text-sm text-foreground/50">Loading…</p>;

  const paidFromWallet = order.walletHold > 0;
  const onHold = order.creditHold && !order.creditApprovedAt;
  // Invoiced at dispatch: the order's documents (sale + debit notes − credit notes) are already
  // in the khata balance in full, whatever advance was allocated to them, so take them out to get
  // the old dues. Not invoiced yet: the whole balance is old dues (negative = advance).
  const invoiced = invoices.some((d) => d.type === "TAX_INVOICE" || d.type === "BILL_OF_SUPPLY");
  const booked = invoices.reduce((s, d) => s + (d.type === "CREDIT_NOTE" ? -d.total : d.total), 0);
  const thisOrder = Math.max(0, (invoiced ? booked : order.totalAmount) - order.walletHold);
  const oldDues = (dues?.balances.receivable ?? 0) - (invoiced ? booked : 0);
  const totalDue = Math.max(0, thisOrder + oldDues);
  const setAmount = (p: number) =>
    setPay({ ...pay, method: pay.method ?? "CASH", amount: (p / 100).toFixed(2).replace(/\.00$/, "") });

  if (order.status === "DELIVERED") {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="page-title">{order.retailer.outletName}</h1>
          <p className="text-sm text-foreground/50">{order.orderNumber}</p>
        </div>
        <p className="flex items-center gap-2 rounded-xl bg-[var(--mint-tint)] text-[var(--mint-text)] p-3 text-sm font-bold">
          <Icon name="check" className="h-4 w-4" /> Delivered
        </p>
        {invoices.length > 0 ? (
          <DeliveryInvoiceCard invoices={invoices} />
        ) : (
          <p className="text-sm text-[var(--muted)]">The invoice will show here once it is ready.</p>
        )}
        <button type="button" className="btn btn-outline w-full" onClick={() => router.push("/delivery")}>
          Back to my deliveries
        </button>
      </div>
    );
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

      {invoices.length > 0 && <DeliveryInvoiceCard invoices={invoices} />}

      <div className="card p-4">
        <p className="text-sm font-semibold mb-3">{order.orderNumber}</p>
        <OrderLines items={order.items} order={order} freeCallout />
        {order.notes && <p className="text-xs text-[var(--muted)] mt-3">Note: {order.notes}</p>}
      </div>

      <div className="card p-4 space-y-4">
        <p className="text-sm font-semibold">Payment</p>

        {onHold && (
          <p className="rounded-xl bg-[#fde4e1] text-[#a8281e] p-3 text-sm font-semibold">
            On credit hold: {order.creditHoldReason ?? "needs approval"}. Ask the office to approve before you deliver.
          </p>
        )}

        {paidFromWallet && (
          <p className="flex items-center gap-2 rounded-xl bg-[var(--mint-tint)] text-[var(--mint-text)] p-3 text-sm font-bold">
            <Icon name="wallet" className="h-4 w-4" /> Paid from wallet {formatINR(Math.min(order.walletHold, order.totalAmount))}
          </p>
        )}

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-black/[0.04] p-2">
            <p className="text-[11px] text-[var(--muted)]">This order</p>
            <p className="font-bold text-sm mt-0.5">{formatINR(thisOrder, { whole: true })}</p>
          </div>
          <div className="rounded-xl bg-black/[0.04] p-2">
            <p className="text-[11px] text-[var(--muted)]">{oldDues < 0 ? "Advance" : "Old dues"}</p>
            <p className={`font-bold text-sm mt-0.5 ${dues && dues.overdue > 0 ? "text-[#a8281e]" : ""}`}>
              {dues ? formatINR(Math.abs(oldDues), { whole: true }) : duesError ? "—" : "…"}
            </p>
          </div>
          <div className="rounded-xl bg-[var(--kesar-tint)] p-2">
            <p className="text-[11px] text-[var(--kesar-text)]">Total due</p>
            <p className="font-bold text-sm mt-0.5 text-[var(--kesar-text)]">{formatINR(totalDue, { whole: true })}</p>
          </div>
        </div>
        {dues && dues.overdue > 0 && (
          <p className="text-xs font-semibold text-[#a8281e]">{formatINR(dues.overdue)} of the old dues is overdue.</p>
        )}
        {duesError && <p className="text-xs text-[var(--muted)]">Could not load old dues.</p>}

        {(thisOrder > 0 || (dues && totalDue > 0)) && (
          <div className="flex gap-2">
            {thisOrder > 0 && (
              <button type="button" className="btn btn-soft btn-sm flex-1" onClick={() => setAmount(thisOrder)}>
                This order
              </button>
            )}
            {dues && totalDue > 0 && totalDue !== thisOrder && (
              <button type="button" className="btn btn-soft btn-sm flex-1" onClick={() => setAmount(totalDue)}>
                Full dues
              </button>
            )}
          </div>
        )}

        <PaymentFields
          value={pay}
          onChangeAction={setPay}
          allowNone
          noneLabel={paidFromWallet ? "Nothing now" : "On credit"}
          hint={
            !pay.method ? (
              <p className="text-sm text-[var(--muted)]">
                {paidFromWallet && totalDue === 0 ? "Nothing to collect." : `${formatINR(totalDue)} stays on the khata.`}
              </p>
            ) : pay.method === "CASH" ? (
              <p className="text-sm text-[var(--ink-2)]">Count the cash before you mark delivered.</p>
            ) : null
          }
        />
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
        disabled={loading || onHold}
        className="btn btn-kesar w-full"
      >
        {loading ? "Completing…" : "Mark delivered"}
      </button>
    </div>
  );
}
