"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getLocation } from "@/lib/geo";
import { formatINR } from "@/lib/money";
import { compressImage, dataUrlToBlob, uploadFile } from "@/lib/upload-client";
import Icon from "@/components/Icon";
import { emptyPayment, paymentError, toCollectBody, type PaymentValue } from "@/components/PaymentFields";
import type { QuoteJson } from "@/components/store/shared";
import CollectCard from "../orders/[id]/CollectCard";
import ProofCard from "../orders/[id]/ProofCard";
import ReturnablesCard, { cratesBody, type CrateState } from "../orders/[id]/ReturnablesCard";
import type { DeliveryInvoice } from "../orders/[id]/DeliveryInvoiceCard";
import { rupees } from "../orders/[id]/deliver-model";
import ShopPicker, { type SpotShop } from "./ShopPicker";
import PickCard, { type FreeRow, type PickState } from "./PickCard";
import BillCard from "./BillCard";
import SoldView, { type SoldSale } from "./SoldView";
import { fetchVan, type VanData } from "./van";

type Dues = { balances: { receivable: number }; overdue: number };
type QuoteRes = { quote: QuoteJson; van: FreeRow[]; over: { productId: string; name: string; want: number; free: number }[] };

/** Numbered step heading, like the stop numbers on the trip. */
function Step({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`h-7 w-7 shrink-0 rounded-lg grid place-items-center text-xs font-bold ${
          done ? "bg-[var(--success-tint)] text-[var(--success-text)]" : "bg-[var(--accent-tint)] text-[var(--accent-text)]"
        }`}
      >
        {done ? <Icon name="check" className="h-3.5 w-3.5" /> : n}
      </span>
      <p className="text-sm font-semibold">{title}</p>
    </div>
  );
}

/**
 * Spot sale on one screen: shop → products from the free van stock → live
 * price → payment, crates, proof → "Sell and deliver". The server prices,
 * checks the van and credit, and places + delivers the order in one go.
 */
export default function SpotSale({ photoRequired }: { photoRequired: boolean }) {
  const router = useRouter();
  const [van, setVan] = useState<VanData | null>(null);
  const [vanError, setVanError] = useState<string | null>(null);
  const [vanNonce, setVanNonce] = useState(0);

  const [shop, setShop] = useState<SpotShop | null>(null);
  const [picks, setPicks] = useState<PickState>({});
  const [quoted, setQuoted] = useState<{ key: string; res: QuoteRes } | null>(null);
  const [quoteError, setQuoteError] = useState<{ key: string; message: string } | null>(null);
  const [nonce, setNonce] = useState(0);

  const [pay, setPay] = useState<PaymentValue>(() => emptyPayment(undefined, "CASH"));
  const [follow, setFollow] = useState<"order" | "dues" | null>("order");
  const [dues, setDues] = useState<Dues | null>(null);
  const [duesError, setDuesError] = useState(false);
  const shopRef = useRef<string | null>(null);
  const [crates, setCrates] = useState<CrateState>({});
  const [signature, setSignature] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [proofKey, setProofKey] = useState(0);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sold, setSold] = useState<SoldSale | null>(null);

  // ── the van: is selling possible, and what is free ──
  useEffect(() => {
    let live = true;
    fetchVan()
      .then((d) => {
        if (!live) return;
        setVan(d);
        setVanError(null);
      })
      .catch((e: unknown) => live && setVanError(e instanceof Error ? e.message : "Could not load the van stock"));
    return () => {
      live = false;
    };
  }, [vanNonce]);

  // ── what we ask the server to price ──
  const items = useMemo(
    () =>
      Object.entries(picks)
        .filter(([, q]) => q > 0)
        .map(([productId, quantity]) => ({ productId, quantity })),
    [picks]
  );
  const shopId = shop?.id ?? null;
  const key = JSON.stringify({ shopId, items, n: nonce });

  useEffect(() => {
    if (!shopId || !items.length) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/delivery/spot-sale/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ retailerId: shopId, items }),
          signal: ctrl.signal,
        });
        const d = await res.json().catch(() => ({}));
        if (ctrl.signal.aborted) return;
        if (!res.ok) return setQuoteError({ key, message: d.error ?? "Could not check prices. Try again." });
        setQuoted({ key, res: d as QuoteRes });
        setQuoteError(null);
      } catch {
        if (!ctrl.signal.aborted) setQuoteError({ key, message: "Network error while checking prices." });
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [key, shopId, items]);

  // Free stock: the latest price check knows best, else the van as loaded.
  const freeRows: FreeRow[] = useMemo(() => {
    const base = (van?.rows ?? []).map((r) => ({ productId: r.productId, name: r.name, unit: r.unit, caseSize: r.caseSize, free: r.free }));
    const latest = quoted?.res.van;
    if (!latest) return base;
    const byId = new Map(latest.map((r) => [r.productId, r]));
    return base.map((r) => ({ ...r, free: byId.get(r.productId)?.free ?? 0 }));
  }, [van, quoted]);

  const quote = shopId && items.length ? (quoted?.res.quote ?? null) : null;
  const fresh = !!quoted && quoted.key === key && items.length > 0;
  const qError = quoteError && quoteError.key === key ? quoteError.message : null;
  const over = useMemo(
    () => (fresh && quoted ? Object.fromEntries(quoted.res.over.map((o) => [o.productId, o.free])) : {}),
    [fresh, quoted]
  );

  function pickShop(s: SpotShop | null) {
    setShop(s);
    setError(null);
    setCrates({});
    setDues(null);
    setDuesError(false);
    setFollow("order");
    shopRef.current = s?.id ?? null;
    if (!s) return;
    fetch(`/api/admin/khata/${s.id}`)
      .then(async (r) => {
        if (shopRef.current !== s.id) return;
        if (r.ok) setDues(await r.json());
        else setDuesError(true);
      })
      .catch(() => shopRef.current === s.id && setDuesError(true));
  }

  function handlePhoto(file: File | null) {
    setPhotoFile(file);
    if (!file) return setPhoto(null);
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.readAsDataURL(file);
  }

  function reset() {
    pickShop(null);
    setPicks({});
    setQuoted(null);
    setQuoteError(null);
    setPay(emptyPayment(undefined, "CASH"));
    setSignature(null);
    setPhoto(null);
    setPhotoFile(null);
    setProofKey((k) => k + 1);
    setSold(null);
    setVanNonce((n) => n + 1);
    window.scrollTo({ top: 0 });
  }

  if (sold) return <SoldView sale={sold} onNewAction={reset} />;

  const head = (
    <div>
      <p className="page-kick">Spot sale</p>
      <h1 className="page-title">Sell from the van</h1>
      {van?.trip?.vehicle && (
        <p className="text-sm text-[var(--muted)] break-all">
          {van.trip.vehicle.number} · {van.trip.number}
        </p>
      )}
    </div>
  );

  // ── can't sell: loading, error, stock off, no running trip, no van ──
  const blocked: string | null = !van
    ? null
    : !van.enabled
      ? "Stock isn't tracked for vans in this business, so spot sales are off."
      : !van.trip
        ? "No trip today. Spot sales come out of the van on a running trip."
        : !van.trip.vehicle
          ? "This trip has no van, so there is no van stock to sell."
          : !van.canSell
            ? "Start your trip first. Then you can sell from the van."
            : null;

  if (!van || blocked) {
    return (
      <div className="space-y-5">
        {head}
        {!van ? (
          vanError ? (
            <div className="card p-5 space-y-3">
              <p className="text-sm text-[var(--risk-text)]">{vanError}</p>
              <button type="button" className="btn btn-outline w-full" onClick={() => setVanNonce((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          )
        ) : (
          <div className="rounded-xl bg-[var(--scheme-tint)] text-[var(--scheme-text)] p-3 text-sm font-semibold">{blocked}</div>
        )}
        <Link href="/delivery" className="btn btn-outline w-full">
          <Icon name="chevronLeft" className="h-4 w-4" /> Back to trip
        </Link>
      </div>
    );
  }

  // ── payment figures (same as the deliver screen; nothing prepaid here) ──
  const thisOrder = quote?.totalAmount ?? 0;
  const oldDues = dues?.balances.receivable ?? 0;
  const totalDue = Math.max(0, thisOrder + oldDues);
  const target = follow === "order" ? thisOrder : follow === "dues" ? totalDue : null;
  const shownPay: PaymentValue = target === null ? pay : { ...pay, amount: rupees(target) };
  const ready = fresh && !!quote && quote.problems.length === 0;

  function onPay(v: PaymentValue) {
    if (v.amount !== shownPay.amount) setFollow(null);
    setPay(v);
  }

  async function sell() {
    if (!shop) return setError("Pick the shop first");
    setError(null);
    const bad =
      (!items.length ? "Add at least one product" : null) ??
      (!fresh || !quote ? "Prices are still being checked. Wait a moment." : null) ??
      (quote && quote.problems.length ? "Fix the problems in red first" : null) ??
      (photoRequired && !photoFile ? "Take a delivery photo first" : null) ??
      paymentError(shownPay);
    if (bad) return setError(bad);
    setBusy(true);
    try {
      const [loc, photoKey, signatureKey, collect] = await Promise.all([
        getLocation(),
        photoFile ? compressImage(photoFile).then((b) => uploadFile(b, "pod-photo")) : null,
        signature ? uploadFile(dataUrlToBlob(signature), "pod-signature") : null,
        toCollectBody(shownPay),
      ]);
      const res = await fetch("/api/delivery/spot-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          retailerId: shop.id,
          items,
          // No `collect` = sold on credit.
          ...(collect ? { collect } : {}),
          returnables: cratesBody(crates),
          podPhotoKey: photoKey,
          podSignatureKey: signatureKey,
          ...loc,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The van or the shop's credit may have changed: price again.
        if (res.status === 409) setNonce((n) => n + 1);
        throw new Error(d.error ?? "Could not make the sale. Try again.");
      }
      const inv = d.invoice as (DeliveryInvoice & { ewbValidUntil: string | null }) | null;
      setSold({
        orderNumber: d.order?.orderNumber ?? "",
        shopName: shop.outletName,
        total: Number(d.total ?? quote?.totalAmount ?? 0),
        collected: collect ? { amount: collect.amount, method: collect.method } : null,
        invoices: inv
          ? [{ id: inv.id, type: inv.type, number: inv.number, total: inv.total, ewbNo: inv.ewbNo ?? null, ewbVehicle: inv.ewbVehicle ?? null, ewbValidUntil: inv.ewbValidUntil ?? null }]
          : [],
      });
      window.scrollTo({ top: 0 });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {head}

      <section className="card p-4 space-y-3">
        <Step n={1} title={shop ? "Shop" : "Pick the shop"} done={!!shop} />
        <ShopPicker shop={shop} onPickAction={pickShop} />
      </section>

      {shop && (
        <section className="card p-4 space-y-3">
          <Step n={2} title="Products from the van" done={items.length > 0} />
          <PickCard rows={freeRows} value={picks} over={over} onChangeAction={setPicks} />
        </section>
      )}

      {shop && items.length > 0 && (
        <>
          <section className="card p-4 space-y-3">
            <Step n={3} title="Bill" done={ready} />
            <BillCard quote={quote} fresh={fresh} error={qError} onRetryAction={() => setNonce((n) => n + 1)} />
          </section>

          <CollectCard
            onHold={false}
            holdReason={null}
            walletPaid={null}
            thisOrder={thisOrder}
            oldDues={oldDues}
            totalDue={totalDue}
            overdue={dues?.overdue ?? 0}
            duesLoaded={!!dues}
            duesError={duesError}
            pay={shownPay}
            onPayAction={onPay}
            onFollowAction={setFollow}
            cashHint="Count the cash before you sell."
          />

          <ReturnablesCard retailerId={shop.id} value={crates} onChangeAction={setCrates} />

          <ProofCard key={proofKey} photoRequired={photoRequired} photo={photo} onPhotoAction={handlePhoto} onSignatureAction={setSignature} />

          {error && (
            <p role="alert" className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-semibold">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <button type="button" onClick={sell} disabled={busy || !ready} className="btn btn-kesar w-full !min-h-[56px] text-base">
              <Icon name="check" />
              {busy
                ? "Saving…"
                : ready && quote
                  ? `Sell and deliver · ${formatINR(quote.totalAmount, { whole: true })}`
                  : !fresh && !qError
                    ? "Checking prices…"
                    : "Sell and deliver"}
            </button>
            {fresh && quote && quote.problems.length > 0 && (
              <p className="text-xs text-center text-[var(--risk-text)] font-semibold">Fix the problems in the bill first.</p>
            )}
          </div>
        </>
      )}

      {shop && items.length === 0 && error && (
        <p role="alert" className="rounded-xl bg-[var(--risk-tint)] text-[var(--risk-text)] p-3 text-sm font-semibold">
          {error}
        </p>
      )}

      <Link href="/delivery" className="btn btn-quiet w-full">
        Cancel
      </Link>
    </div>
  );
}
