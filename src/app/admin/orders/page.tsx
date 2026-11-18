"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";
import { STATUS_COLOR, nextStatus } from "@/lib/orders";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { OrderStatus } from "@/generated/prisma/client";
import OrderLines, { type OrderLineItem, type OrderTotals } from "@/components/store/OrderLines";

type Order = OrderTotals & {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  createdAt: string;
  creditHold: boolean;
  creditHoldReason: string | null;
  creditApprovedAt: string | null;
  /** Paise reserved from the retailer's wallet for this order. */
  walletHold: number;
  retailer: { outletName: string; area: { name: string } };
  items: OrderLineItem[];
  delivery: { deliveryAgent: { id: string; user: { name: string } } } | null;
};

type Agent = { id: string; user: { name: string } };

const FILTERS: (OrderStatus | "ALL")[] = [
  "ALL",
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

export default function AdminOrdersPage() {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Last failed action, shown on that order's card. */
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null);

  async function load() {
    const qs = filter === "ALL" ? "" : `?status=${filter}`;
    try {
      const [oRes, aRes] = await Promise.all([fetch(`/api/admin/orders${qs}`), fetch("/api/admin/delivery-agents")]);
      const [o, a] = await Promise.all([oRes.json().catch(() => ({})), aRes.json().catch(() => ({}))]);
      if (!oRes.ok) throw new Error(o.error ?? "Could not load orders");
      setOrders(o.orders ?? []);
      setAgents(aRes.ok ? (a.agents ?? []) : []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load orders");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function send(id: string, url: string, method: "PATCH" | "POST", body: Record<string, unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError({ id, message: data.error ?? "Something went wrong" });
      }
    } catch {
      setActionError({ id, message: "Network error. Try again." });
    }
    await load();
    setBusyId(null);
  }

  const advance = (id: string) => send(id, `/api/orders/${id}/status`, "PATCH", { action: "advance" });
  const approveCredit = (id: string) => send(id, `/api/orders/${id}/status`, "PATCH", { action: "approve_credit" });
  const cancel = (id: string) => send(id, `/api/orders/${id}/status`, "PATCH", { action: "cancel" });
  function assign(id: string, deliveryAgentId: string) {
    if (!deliveryAgentId) return;
    send(id, `/api/orders/${id}/assign-delivery`, "POST", { deliveryAgentId });
  }

  return (
    <div className="space-y-4">
      <h1 className="page-title">Orders</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
              filter === f ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-black/5 text-foreground/60"
            }`}
          >
            {f === "ALL" ? "All" : t(`status.${f}`)}
          </button>
        ))}
      </div>

      {loadError && <p className="text-sm text-[#a8281e]">{loadError}</p>}

      <div className="space-y-3">
        {orders.map((o) => {
          const upcoming = nextStatus(o.status);
          const open = o.status !== "DELIVERED" && o.status !== "CANCELLED";
          const held = o.creditHold && !o.creditApprovedAt;
          const approved = o.creditHold && !!o.creditApprovedAt;
          return (
            <div key={o.id} className="card p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{o.retailer.outletName}</p>
                  <p className="text-xs text-foreground/50">
                    {o.orderNumber} · {o.retailer.area.name} · {o.items.length} items · {formatINR(o.totalAmount)}
                  </p>
                </div>
                <span className={`shrink-0 text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
                  {t(`status.${o.status}`)}
                </span>
              </div>

              <details className="group">
                <summary className="cursor-pointer text-xs font-bold text-[var(--kesar-text)] list-none">
                  <span className="group-open:hidden">Show items and totals</span>
                  <span className="hidden group-open:inline">Hide items</span>
                </summary>
                <div className="pt-3">
                  <OrderLines items={o.items} order={o} />
                </div>
              </details>

              {((held && open) || (approved && open) || o.walletHold > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                  {held && open && (
                    <span className="chip chip-kesar !whitespace-normal">
                      Credit hold{o.creditHoldReason ? `: ${o.creditHoldReason}` : ""}
                    </span>
                  )}
                  {approved && open && <span className="chip chip-mint">Credit approved</span>}
                  {o.walletHold > 0 && (
                    <span className="text-xs text-[var(--muted)]">Wallet {formatINR(o.walletHold)} reserved</span>
                  )}
                </div>
              )}

              {open && (
                <div className="flex flex-wrap items-center gap-2">
                  {held ? (
                    <button
                      disabled={busyId === o.id}
                      onClick={() => approveCredit(o.id)}
                      className="btn btn-mor btn-xs"
                    >
                      Approve credit
                    </button>
                  ) : o.status === "OUT_FOR_DELIVERY" ? (
                    <span className="text-xs font-medium text-[var(--ink-2)]">With delivery agent</span>
                  ) : (
                    upcoming &&
                    upcoming !== "OUT_FOR_DELIVERY" &&
                    upcoming !== "DELIVERED" && (
                      <button
                        disabled={busyId === o.id}
                        onClick={() => advance(o.id)}
                        className="btn btn-soft btn-xs"
                      >
                        Mark {t(`status.${upcoming}`)}
                      </button>
                    )
                  )}
                  {o.status !== "OUT_FOR_DELIVERY" && (
                    <select
                      className="text-xs rounded-lg border border-black/10 px-2 py-1.5"
                      value=""
                      disabled={busyId === o.id || held}
                      onChange={(e) => assign(o.id, e.target.value)}
                    >
                      <option value="" disabled>
                        {held ? "Approve credit to assign" : "Assign delivery agent…"}
                      </option>
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.user.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    disabled={busyId === o.id}
                    onClick={() => cancel(o.id)}
                    className="btn btn-danger btn-xs"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {actionError?.id === o.id && <p className="text-xs text-[#a8281e]">{actionError.message}</p>}

              {o.delivery?.deliveryAgent && (
                <p className="text-xs text-foreground/50">
                  Delivery agent: {o.delivery.deliveryAgent.user.name}
                </p>
              )}
            </div>
          );
        })}
        {orders.length === 0 && !loadError && <p className="text-sm text-foreground/50">No orders in this filter.</p>}
      </div>
    </div>
  );
}
