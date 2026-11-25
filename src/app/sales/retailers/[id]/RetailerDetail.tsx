"use client";

import Icon from "@/components/Icon";
import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";
import { useRouter } from "next/navigation";
import Storefront from "@/components/Storefront";
import { STATUS_COLOR } from "@/lib/orders";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { OrderStatus as OrderStatusKey } from "@/generated/prisma/client";
import PaymentFields, { emptyPayment, paymentError, toCollectBody, type PaymentValue } from "@/components/PaymentFields";
import Link from "next/link";
import { errText } from "@/components/admin/AdminKit";
import { NoOrderSheet, endVisit, startVisit } from "@/components/field/VisitKit";
import { clock, type VisitsToday } from "@/components/field/kit";
import ComplaintSheet from "@/components/engage/ComplaintSheet";
import PayLinkCard from "./PayLinkCard";
import ShelfAuditCard from "@/components/field/ShelfAuditCard";

const daysOld = (s: string) => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 86_400_000));

type Dues = {
  terms: { mode: "PREPAID" | "POSTPAID" };
  balances: { receivable: number; walletAvailable: number };
  overdue: number;
  openBills: { id: string; number: string; date: string; due: number; overdue: boolean }[];
};

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
};

/** `invoices`: the "Recent invoices" block, rendered on the server by the page. */
export default function RetailerDetail({ id, invoices }: { id: string; invoices?: React.ReactNode }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [retailer, setRetailer] = useState<RetailerDetail | null>(null);
  // ?order=1 (from the beat's "Take order") opens the order screen straight away.
  const [showOrder, setShowOrder] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("order") === "1"
  );
  const [visits, setVisits] = useState<VisitsToday | null>(null);
  const [visitBusy, setVisitBusy] = useState(false);
  const [visitError, setVisitError] = useState<string | null>(null);
  const [noOrder, setNoOrder] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const [dues, setDues] = useState<Dues | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [pay, setPay] = useState<PaymentValue>(() => emptyPayment());
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [payDone, setPayDone] = useState<string | null>(null);
  const [complaint, setComplaint] = useState(false);
  const [raised, setRaised] = useState<string | null>(null);

  async function load() {
    const d = await fetch(`/api/sales/retailers/${id}`).then((r) => r.json());
    setRetailer(d.retailer);
    await loadVisits();
    const k = await fetch(`/api/admin/khata/${id}`);
    setDues(k.ok ? await k.json() : null);
  }

  /** My open visit (any shop) decides check in / take order / check out here. */
  async function loadVisits() {
    const v = await fetch("/api/visits");
    setVisits(v.ok ? await v.json() : null);
  }

  function openCollect() {
    setPay(emptyPayment(dues && dues.balances.receivable > 0 ? dues.balances.receivable : undefined));
    setPayError(null);
    setPayDone(null);
    setCollecting(true);
  }

  async function collect() {
    setPayError(null);
    const bad = paymentError(pay);
    if (bad) return setPayError(bad);
    setPaySaving(true);
    try {
      const body = await toCollectBody(pay);
      if (!body) return;
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retailerId: id, ...body, purpose: "DUES" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save the payment");
      setCollecting(false);
      setPayDone(`${formatINR(body.amount)} collected. Receipt ${data.payment?.number ?? ""}`.trim());
      await load();
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPaySaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function checkIn() {
    setVisitBusy(true);
    setVisitError(null);
    try {
      await startVisit(id);
      await loadVisits();
    } catch (e) {
      setVisitError(errText(e));
    } finally {
      setVisitBusy(false);
    }
  }

  /** Check out after an order was placed on the visit (no reason needed). */
  async function checkOutVisit(visitId: string) {
    setVisitBusy(true);
    setVisitError(null);
    try {
      await endVisit(visitId);
      setPlaced(null);
      await loadVisits();
    } catch (e) {
      setVisitError(errText(e));
    } finally {
      setVisitBusy(false);
    }
  }

  if (!retailer) return <p className="text-sm text-foreground/50">Loading…</p>;

  const open = visits?.open ?? null;
  const openVisit = open && open.retailerId === id ? open : null;
  const openElsewhere = open && open.retailerId !== id ? open : null;

  if (showOrder) {
    return (
      <div>
        <button
          className="text-sm text-[var(--accent-text)] mb-3 min-h-[44px]"
          onClick={() => {
            setShowOrder(false);
            if (window.location.search.includes("order=1")) router.replace(`/sales/retailers/${id}`);
          }}
        >
          ← Back to {retailer.outletName}
        </button>
        {!openVisit && (
          <p className="text-xs text-[var(--muted)] mb-3">
            You are not checked in at this shop, so this order won&apos;t count as a visit.
          </p>
        )}
        <Storefront
          retailerId={id}
          visitId={openVisit?.id}
          submitLabel="Place order for retailer"
          onPlacedAction={async (order) => {
            if (!openVisit) return router.push("/sales/orders");
            // Back to the shop: the visit now has its order; check out from here.
            setShowOrder(false);
            setPlaced(`Order ${order.orderNumber} placed. Check out when you leave the shop.`);
            router.replace(`/sales/retailers/${id}`);
            await load();
          }}
        />
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
          <p className="text-sm text-foreground/50 flex items-center gap-1.5"><Icon name="phone" className="h-4 w-4" /> {retailer.user.phone}</p>
        )}
      </div>

      {visits && (
        <div className={`card p-4 space-y-3 ${openVisit ? "border-2 !border-[var(--accent)]" : ""}`}>
          {openVisit ? (
            <>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--accent-text)]">Visit in progress</p>
                <p className="text-sm font-medium">
                  Checked in at {clock(openVisit.checkInAt)}
                  {openVisit.orderId ? " · Order placed" : ""}
                </p>
              </div>
              {placed && <p className="text-sm font-semibold text-[var(--success-text)]">{placed}</p>}
              {openVisit.orderId ? (
                <button onClick={() => checkOutVisit(openVisit.id)} disabled={visitBusy} className="btn btn-kesar w-full min-h-[44px]">
                  {visitBusy ? "Saving…" : "Check out"}
                </button>
              ) : (
                <button onClick={() => setNoOrder(true)} disabled={visitBusy} className="btn btn-quiet w-full min-h-[44px]">
                  No order. Check out
                </button>
              )}
            </>
          ) : openElsewhere ? (
            <p className="text-sm">
              You are checked in at{" "}
              <Link href={`/sales/retailers/${openElsewhere.retailerId}`} className="font-semibold text-[var(--accent-text)] underline">
                {openElsewhere.retailer.outletName}
              </Link>
              . Check out there before visiting this shop.
            </p>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-[var(--muted)]">Not checked in at this shop</p>
              <button onClick={checkIn} disabled={visitBusy} className="btn btn-kesar min-h-[48px] shrink-0">
                {visitBusy ? "Checking in…" : "Check in"}
              </button>
            </div>
          )}
          {visitError && <p className="text-sm text-[var(--risk-text)]">{visitError}</p>}
        </div>
      )}

      {noOrder && openVisit && (
        <NoOrderSheet
          visitId={openVisit.id}
          shopName={retailer.outletName}
          onClose={() => setNoOrder(false)}
          onDone={async () => {
            setNoOrder(false);
            await loadVisits();
          }}
        />
      )}

      {dues && (
        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-[var(--muted)]">
                {dues.balances.receivable > 0 ? "Dues" : dues.balances.receivable < 0 ? "Advance" : "Dues"}
              </p>
              <p className={`stat-num !text-2xl mt-1 ${dues.overdue > 0 ? "text-[var(--risk-text)]" : "text-[var(--money)]"}`}>
                {dues.balances.receivable === 0 ? "All paid" : formatINR(Math.abs(dues.balances.receivable))}
              </p>
            </div>
            {dues.overdue > 0 ? (
              <span className="chip bg-[var(--risk-tint)] text-[var(--risk-text)] border-transparent">{formatINR(dues.overdue, { whole: true })} overdue</span>
            ) : dues.terms.mode === "PREPAID" ? (
              <span className="chip chip-mint">Wallet {formatINR(dues.balances.walletAvailable, { whole: true })}</span>
            ) : null}
          </div>
          {dues.openBills[0] && (
            <p className={`text-xs ${dues.openBills[0].overdue ? "text-[var(--risk-text)] font-semibold" : "text-[var(--muted)]"}`}>
              Oldest bill {dues.openBills[0].number}: {formatINR(dues.openBills[0].due)},{" "}
              {daysOld(dues.openBills[0].date)} days old
            </p>
          )}
          {payDone && <p className="text-sm font-semibold text-[var(--success-text)]">{payDone}</p>}

          {collecting ? (
            <div className="border-t border-black/5 pt-3 space-y-3">
              <p className="text-sm font-semibold">Collect payment</p>
              <PaymentFields value={pay} onChangeAction={setPay} methods={["CASH", "UPI", "CHEQUE"]} field />
              {payError && <p className="text-sm text-[var(--risk-text)]">{payError}</p>}
              <div className="flex gap-2">
                <button className="btn btn-quiet flex-1" onClick={() => setCollecting(false)} disabled={paySaving}>
                  Cancel
                </button>
                <button className="btn btn-mor flex-[2]" onClick={collect} disabled={paySaving}>
                  {paySaving ? "Saving…" : "Save payment"}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-outline w-full" onClick={openCollect}>
              Collect payment
            </button>
          )}

          {!collecting && (
            <PayLinkCard
              retailerId={id}
              outletName={retailer.outletName}
              phone={retailer.user.phone}
              dues={Math.max(0, dues.balances.receivable)}
              onPaidAction={load}
            />
          )}
        </div>
      )}

      <button
        onClick={() => setShowOrder(true)}
        className="btn btn-kesar w-full"
      >
        Capture order
      </button>

      <ShelfAuditCard retailerId={id} visitId={openVisit?.id ?? null} />

      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Problem at this shop?</p>
            <p className="text-xs text-[var(--muted)]">Damaged or missing goods, bill problems. The office follows up.</p>
          </div>
          <button type="button" className="btn btn-quiet btn-sm shrink-0" onClick={() => setComplaint(true)}>
            Raise complaint
          </button>
        </div>
        {raised && <p className="text-sm font-semibold text-[var(--success-text)]">{raised}</p>}
      </div>

      {complaint && (
        <ComplaintSheet
          retailerId={id}
          shopName={retailer.outletName}
          orders={retailer.orders.slice(0, 20).map((o) => ({ id: o.id, orderNumber: o.orderNumber, totalAmount: o.totalAmount, createdAt: o.createdAt }))}
          onClose={() => setComplaint(false)}
          onRaised={(t) => {
            setComplaint(false);
            setRaised(`Complaint ${t.number} raised. The office will take it up.`);
          }}
        />
      )}

      <div>
        <p className="text-sm font-semibold mb-2">Recent orders</p>
        <div className="space-y-2">
          {retailer.orders.map((o) => (
            <div key={o.id} className="card p-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{o.orderNumber}</p>
                <p className="text-xs text-foreground/50">
                  {new Date(o.createdAt).toLocaleDateString()} · {formatINR(o.totalAmount)}
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

      {invoices}
    </div>
  );
}
