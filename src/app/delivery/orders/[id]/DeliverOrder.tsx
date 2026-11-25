"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getLocation } from "@/lib/geo";
import { FAIL_REASONS } from "@/lib/delivery-settings";
import { compressImage, dataUrlToBlob, uploadFile } from "@/lib/upload-client";
import Icon from "@/components/Icon";
import { emptyPayment, paymentError, toCollectBody, type PaymentValue } from "@/components/PaymentFields";
import PrefNote from "../../PrefNote";
import { shopMapUrl } from "../../maps";
import DeliveryInvoiceCard, { type DeliveryInvoice } from "./DeliveryInvoiceCard";
import LinesCard from "./LinesCard";
import CollectCard from "./CollectCard";
import QrPayCard, { type OnlinePaid } from "./QrPayCard";
import ProofCard from "./ProofCard";
import StepChecklist from "@/components/ui/StepChecklist";
import ReturnablesCard, { cratesBody, type CrateState } from "./ReturnablesCard";
import NotDeliveredSheet from "./NotDeliveredSheet";
import DeliveredView from "./DeliveredView";
import { fullLines, linesBody, linesError, orderAmount, rupees, type DeliverItem, type LineState } from "./deliver-model";

type Dues = { balances: { receivable: number }; overdue: number };

export type OrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  deliveryCharge: number;
  deliveryGstRate: number;
  notes: string | null;
  retailerId: string;
  /** Paise reserved from the retailer's wallet (prepaid); paid automatically on delivery. */
  walletHold: number;
  creditHold: boolean;
  creditHoldReason: string | null;
  creditApprovedAt: string | null;
  retailer: {
    outletName: string;
    shopNumber: string;
    complexName: string;
    pinCode: string;
    lat: number | null;
    lng: number | null;
    deliveryPref: string | null;
    deliveryNote: string | null;
    area: { name: string } | null;
    user: { phone: string | null };
  };
  items: DeliverItem[];
  delivery: { state: "ASSIGNED" | "DELIVERED" | "FAILED"; codeNeeded: boolean; failReason: string | null; failNote: string | null } | null;
};

/**
 * Deliver one order: count each line, collect, proof, crates; or "Couldn't
 * deliver". `invoices`: documents already issued (refreshed after delivery);
 * `tripStatus`: the stop's trip, if it is on one.
 */
export default function DeliverOrder({
  id,
  invoices,
  photoRequired,
  tripStatus,
}: {
  id: string;
  invoices: DeliveryInvoice[];
  photoRequired: boolean;
  tripStatus: "PLANNED" | "STARTED" | "CLOSED" | null;
}) {
  const router = useRouter();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState>({});
  const [pay, setPay] = useState<PaymentValue>(() => emptyPayment(undefined, null));
  /** The amount box follows this figure until the driver types their own. */
  const [follow, setFollow] = useState<"order" | "dues" | null>(null);
  const [dues, setDues] = useState<Dues | null>(null);
  const [duesError, setDuesError] = useState(false);
  const [code, setCode] = useState("");
  const [crates, setCrates] = useState<CrateState>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failOpen, setFailOpen] = useState(false);
  /** Paid by the shop through the gateway QR for this order. */
  const [online, setOnline] = useState<OnlinePaid>({ paid: 0, full: false });

  useEffect(() => {
    fetch(`/api/orders/${id}`)
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { order?: OrderDetail; error?: string };
        if (!r.ok || !d.order) throw new Error(d.error ?? "Could not load the order");
        return d.order;
      })
      .then((o) => {
        setOrder(o);
        setLines(fullLines(o.items));
        // Prepaid orders are paid from the wallet on delivery: nothing to collect by default.
        const prepaid = o.walletHold > 0;
        setPay(emptyPayment(undefined, prepaid ? null : "CASH"));
        setFollow(prepaid ? null : "order");
        fetch(`/api/admin/khata/${o.retailerId}`)
          .then(async (r) => (r.ok ? setDues(await r.json()) : setDuesError(true)))
          .catch(() => setDuesError(true));
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load the order"));
  }, [id]);

  // Money came in online: the khata balance moved, so read the dues again.
  const retailerId = order?.retailerId ?? null;
  useEffect(() => {
    if (!retailerId || online.paid === 0) return;
    let live = true;
    fetch(`/api/admin/khata/${retailerId}`)
      .then(async (r) => {
        if (r.ok && live) setDues(await r.json());
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [retailerId, online.paid]);

  function handlePhoto(file: File | null) {
    setPhotoFile(file);
    if (!file) return setPhoto(null);
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  if (!order) {
    return loadError ? (
      <div className="card p-5 space-y-3">
        <p className="text-sm text-[var(--risk-text)]">{loadError}</p>
        <Link href="/delivery" className="btn btn-outline w-full">
          Back to my stops
        </Link>
      </div>
    ) : (
      <p className="text-sm text-foreground/50">Loading…</p>
    );
  }

  if (order.status === "DELIVERED") return <DeliveredView order={order} invoices={invoices} />;

  if (order.delivery?.state === "FAILED") {
    const r = order.delivery.failReason;
    return (
      <div className="space-y-5">
        <h1 className="page-title">{order.retailer.outletName}</h1>
        <p className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-bold">
          Not delivered: {r && r in FAIL_REASONS ? FAIL_REASONS[r as keyof typeof FAIL_REASONS] : "no reason"}
          {order.delivery.failNote ? ` (${order.delivery.failNote})` : ""}
        </p>
        <p className="text-sm text-[var(--muted)]">The office will put this order on another trip.</p>
        <Link href="/delivery" className="btn btn-outline w-full">
          Back to my stops
        </Link>
      </div>
    );
  }

  const calc = orderAmount(order, order.items, lines, invoices);
  const prepaid = order.walletHold > 0;
  const onHold = order.creditHold && !order.creditApprovedAt;
  const thisOrder = Math.max(0, calc.amount - order.walletHold - online.paid);
  // Invoiced at dispatch: the documents so far are already in the khata balance in full, so take
  // them out to get the old dues (the short-delivery credit is issued only on saving). Not
  // invoiced yet: the whole balance is old dues (negative = advance). Money paid online for this
  // order already lowered the balance: add it back here, it is taken off "This order" instead.
  const oldDues = (dues?.balances.receivable ?? 0) - (calc.invoiced ? calc.booked : 0) + online.paid;
  const totalDue = Math.max(0, thisOrder + oldDues);
  const target = follow === "order" ? thisOrder : follow === "dues" ? totalDue : null;
  const blocked = tripStatus === "PLANNED" || tripStatus === "CLOSED";
  // Fully paid by QR: nothing to collect (the server marks the delivery paid online).
  const paidOnline = online.full && !onHold;
  const shownPay: PaymentValue = paidOnline ? { ...pay, method: null } : target === null ? pay : { ...pay, amount: rupees(target) };
  const r = order.retailer;
  const address = [r.shopNumber && `Shop ${r.shopNumber}`, r.complexName, r.area?.name, r.pinCode].filter(Boolean).join(", ");
  const map = shopMapUrl({ lat: r.lat, lng: r.lng, address });

  function onPay(v: PaymentValue) {
    if (v.amount !== shownPay.amount) setFollow(null);
    setPay(v);
  }

  async function complete() {
    if (!order) return;
    setError(null);
    const bad =
      linesError(order.items, lines) ??
      (order.delivery?.codeNeeded && !/^\d{4}$/.test(code.trim()) ? "Enter the 4-digit delivery code from the retailer" : null) ??
      (photoRequired && !photoFile ? "Take a delivery photo first" : null) ??
      paymentError(shownPay);
    if (bad) return setError(bad);
    setLoading(true);
    try {
      // Photos go to file storage; the order keeps only the storage keys.
      const [loc, photoKey, signatureKey, collect] = await Promise.all([
        getLocation(),
        photoFile ? compressImage(photoFile).then((b) => uploadFile(b, "pod-photo")) : null,
        signature ? uploadFile(dataUrlToBlob(signature), "pod-signature") : null,
        toCollectBody(shownPay),
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
          ...(order.delivery?.codeNeeded ? { code: code.trim() } : {}),
          lines: linesBody(order.items, lines),
          returnables: cratesBody(crates),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save. Try again.");
      // Nothing to share: straight back to the stop list.
      if (!data.invoice && !data.creditNote && invoices.length === 0) {
        router.push("/delivery");
        router.refresh();
        return;
      }
      // Else stay: the invoice (issued at dispatch or just now) can be shared straight away.
      setOrder({
        ...order,
        status: "DELIVERED",
        items: order.items.map((i) => ({ ...i, deliveredQty: lines[i.id]?.qty ?? i.quantity, shortReason: lines[i.id]?.reason || null })),
      });
      window.scrollTo({ top: 0 });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <h1 className="page-title">{r.outletName}</h1>
          <p className="text-sm text-[var(--muted)]">{address}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {r.user.phone ? (
            <a href={`tel:${r.user.phone}`} className="btn btn-outline">
              <Icon name="phone" className="h-4 w-4" /> Call
            </a>
          ) : (
            <span className="btn btn-outline opacity-50" aria-disabled="true">
              No phone
            </span>
          )}
          {map ? (
            <a href={map} target="_blank" rel="noopener noreferrer" className="btn btn-outline">
              <Icon name="map" className="h-4 w-4" /> Directions
            </a>
          ) : (
            <span />
          )}
        </div>
        <PrefNote pref={r.deliveryPref} note={r.deliveryNote} />
      </div>

      {blocked && (
        <div className="rounded-xl bg-[var(--scheme-tint)] text-[var(--scheme-text)] p-3 text-sm font-semibold space-y-2">
          <p>{tripStatus === "PLANNED" ? "Start the trip first. Then you can deliver this order." : "This trip is closed."}</p>
          <Link href="/delivery" className="btn btn-outline btn-sm">
            Go to my trips
          </Link>
        </div>
      )}

      <StepChecklist
        steps={[
          { label: "Items checked", hint: "Count each line below", done: linesError(order.items, lines) === null },
          { label: "Proof", hint: photoRequired ? "Photo required, signature optional" : "Photo and signature", done: !!photoFile || (!!signature && !photoRequired) },
          { label: "Payment", hint: "UPI, cash or khata", done: paidOnline || paymentError(shownPay) === null },
        ]}
      />

      {invoices.length > 0 && <DeliveryInvoiceCard invoices={invoices} />}

      <LinesCard
        orderNumber={order.orderNumber}
        items={order.items}
        lines={lines}
        onChangeAction={setLines}
        full={calc.full}
        amount={calc.amount}
        notes={order.notes}
      />

      {order.delivery?.codeNeeded && (
        <div className="card p-4 space-y-2">
          <label className="block">
            <span className="text-sm font-semibold">Delivery code</span>
            <span className="block text-xs text-[var(--muted)] mt-0.5">Ask the retailer for the 4-digit code in their app.</span>
            <input
              className="input mt-2 !text-2xl font-heading font-bold tracking-[0.5em] text-center"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="····"
            />
          </label>
        </div>
      )}

      <ReturnablesCard retailerId={order.retailerId} value={crates} onChangeAction={setCrates} />

      <QrPayCard
        orderId={order.id}
        retailerId={order.retailerId}
        amount={thisOrder}
        askAmount={calc.anyShort || prepaid}
        canMake={!onHold && !blocked && thisOrder > 0}
        onChangeAction={setOnline}
      />

      {!paidOnline && (
        <CollectCard
          onHold={onHold}
          holdReason={order.creditHoldReason}
          walletPaid={prepaid ? Math.min(order.walletHold, calc.amount) : null}
          thisOrder={thisOrder}
          oldDues={oldDues}
          totalDue={totalDue}
          overdue={dues?.overdue ?? 0}
          duesLoaded={!!dues}
          duesError={duesError}
          pay={shownPay}
          onPayAction={onPay}
          onFollowAction={setFollow}
        />
      )}

      <ProofCard photoRequired={photoRequired} photo={photo} onPhotoAction={handlePhoto} onSignatureAction={setSignature} />

      {error && (
        <p role="alert" className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-semibold">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <button onClick={complete} disabled={loading || onHold || blocked} className="btn btn-kesar w-full !min-h-[56px] text-base">
          <Icon name="check" /> {loading ? "Saving…" : "Mark delivered"}
        </button>
        {!blocked && (
          <button type="button" className="btn btn-outline w-full" onClick={() => setFailOpen(true)} disabled={loading}>
            <Icon name="x" className="h-4 w-4" /> Couldn&apos;t deliver
          </button>
        )}
      </div>

      <NotDeliveredSheet orderId={order.id} open={failOpen} onCloseAction={() => setFailOpen(false)} />
    </div>
  );
}
