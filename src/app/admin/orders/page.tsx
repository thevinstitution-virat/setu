"use client";

import { useEffect, useState } from "react";
import { STATUS_COLOR, nextStatus } from "@/lib/orders";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { OrderStatus } from "@/generated/prisma/client";

type Order = {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  totalAmount: number;
  createdAt: string;
  retailer: { outletName: string; area: { name: string } };
  items: { id: string }[];
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

  async function load() {
    const qs = filter === "ALL" ? "" : `?status=${filter}`;
    const [o, a] = await Promise.all([
      fetch(`/api/admin/orders${qs}`).then((r) => r.json()),
      fetch("/api/admin/delivery-agents").then((r) => r.json()),
    ]);
    setOrders(o.orders ?? []);
    setAgents(a.agents ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function advance(id: string) {
    setBusyId(id);
    await fetch(`/api/orders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "advance" }),
    });
    await load();
    setBusyId(null);
  }

  async function cancel(id: string) {
    setBusyId(id);
    await fetch(`/api/orders/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    await load();
    setBusyId(null);
  }

  async function assign(id: string, deliveryAgentId: string) {
    if (!deliveryAgentId) return;
    setBusyId(id);
    await fetch(`/api/orders/${id}/assign-delivery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryAgentId }),
    });
    await load();
    setBusyId(null);
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

      <div className="space-y-3">
        {orders.map((o) => {
          const upcoming = nextStatus(o.status);
          return (
            <div key={o.id} className="card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{o.retailer.outletName}</p>
                  <p className="text-xs text-foreground/50">
                    {o.orderNumber} · {o.retailer.area.name} · {o.items.length} items · ₹
                    {o.totalAmount.toFixed(2)}
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>
                  {t(`status.${o.status}`)}
                </span>
              </div>

              {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
                <div className="flex flex-wrap items-center gap-2">
                  {upcoming && upcoming !== "OUT_FOR_DELIVERY" && (
                    <button
                      disabled={busyId === o.id}
                      onClick={() => advance(o.id)}
                      className="btn btn-soft btn-xs"
                    >
                      Mark {t(`status.${upcoming}`)}
                    </button>
                  )}
                  {o.status !== "OUT_FOR_DELIVERY" && (
                    <select
                      className="text-xs rounded-lg border border-black/10 px-2 py-1.5"
                      defaultValue=""
                      disabled={busyId === o.id}
                      onChange={(e) => assign(o.id, e.target.value)}
                    >
                      <option value="" disabled>
                        Assign delivery agent…
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

              {o.delivery?.deliveryAgent && (
                <p className="text-xs text-foreground/50">
                  Delivery agent: {o.delivery.deliveryAgent.user.name}
                </p>
              )}
            </div>
          );
        })}
        {orders.length === 0 && <p className="text-sm text-foreground/50">No orders in this filter.</p>}
      </div>
    </div>
  );
}
