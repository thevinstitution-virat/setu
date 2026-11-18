"use client";

import { useEffect, useState, use as usePromise } from "react";
import { formatINR } from "@/lib/money";
import { useRouter } from "next/navigation";
import Storefront from "@/components/Storefront";
import { STATUS_COLOR } from "@/lib/orders";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { OrderStatus as OrderStatusKey } from "@/generated/prisma/client";
import PaymentFields, { emptyPayment, paymentError, toCollectBody, type PaymentValue } from "@/components/PaymentFields";

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
  const [showOrder, setShowOrder] = useState(false);
  const [dues, setDues] = useState<Dues | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [pay, setPay] = useState<PaymentValue>(() => emptyPayment());
  const [payError, setPayError] = useState<string | null>(null);
  const [paySaving, setPaySaving] = useState(false);
  const [payDone, setPayDone] = useState<string | null>(null);

  async function load() {
    const d = await fetch(`/api/sales/retailers/${id}`).then((r) => r.json());
    setRetailer(d.retailer);
    const k = await fetch(`/api/admin/khata/${id}`);
    setDues(k.ok ? await k.json() : null);
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
        <Storefront
          retailerId={id}
          visitId={openVisit?.id}
          submitLabel="Place order for retailer"
          onPlacedAction={() => router.push("/sales/orders")}
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

      {dues && (
        <div className="card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-[var(--muted)]">
                {dues.balances.receivable > 0 ? "Dues" : dues.balances.receivable < 0 ? "Advance" : "Dues"}
              </p>
              <p className="stat-num !text-2xl mt-1">
                {dues.balances.receivable === 0 ? "All paid" : formatINR(Math.abs(dues.balances.receivable))}
              </p>
            </div>
            {dues.overdue > 0 ? (
              <span className="chip bg-[#fde4e1] text-[#a8281e] border-transparent">{formatINR(dues.overdue, { whole: true })} overdue</span>
            ) : dues.terms.mode === "PREPAID" ? (
              <span className="chip chip-mint">Wallet {formatINR(dues.balances.walletAvailable, { whole: true })}</span>
            ) : null}
          </div>
          {dues.openBills[0] && (
            <p className={`text-xs ${dues.openBills[0].overdue ? "text-[#a8281e] font-semibold" : "text-[var(--muted)]"}`}>
              Oldest bill {dues.openBills[0].number}: {formatINR(dues.openBills[0].due)},{" "}
              {daysOld(dues.openBills[0].date)} days old
            </p>
          )}
          {payDone && <p className="text-sm font-semibold text-[var(--mint-text)]">{payDone}</p>}

          {collecting ? (
            <div className="border-t border-black/5 pt-3 space-y-3">
              <p className="text-sm font-semibold">Collect payment</p>
              <PaymentFields value={pay} onChangeAction={setPay} methods={["CASH", "UPI", "CHEQUE"]} />
              {payError && <p className="text-sm text-[#a8281e]">{payError}</p>}
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
    </div>
  );
}
