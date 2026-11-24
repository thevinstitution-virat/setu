"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
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
  /** Sold by a driver from van stock and delivered on the spot. */
  spot?: boolean;
  retailer: { outletName: string; area: { name: string } };
  items: OrderLineItem[];
  delivery: { deliveryAgent: { id: string; user: { name: string } } } | null;
  /** The sale invoice, once issued (at most one). */
  invoices: { id: string; number: string }[];
  /** Salesman credited with the sale (User id). */
  salesmanId: string | null;
};

type Agent = { id: string; user: { name: string } };
type Salesman = { id: string; name: string };

const FILTERS: (OrderStatus | "ALL")[] = ["ALL", "PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];
const STEPS: OrderStatus[] = ["PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY", "DELIVERED"];

type SP = { q?: string | string[]; status?: string | string[] };

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  return today
    ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
};

export default function AdminOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { q: initialQ, status: initialStatus } = use(searchParams);
  const { t } = useLanguage();
  const [q, setQ] = useState(typeof initialQ === "string" ? initialQ : "");
  const [orders, setOrders] = useState<Order[]>([]);
  const [counts, setCounts] = useState<Partial<Record<OrderStatus, number>>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(
    typeof initialStatus === "string" && (FILTERS as string[]).includes(initialStatus) ? (initialStatus as OrderStatus) : "ALL"
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Last failed action, shown in that order's panel. */
  const [actionError, setActionError] = useState<{ id: string; message: string; ok?: boolean } | null>(null);

  async function load() {
    const qs = filter === "ALL" ? "" : `?status=${filter}`;
    try {
      const [oRes, aRes] = await Promise.all([fetch(`/api/admin/orders${qs}`), fetch("/api/admin/delivery-agents")]);
      const [o, a] = await Promise.all([oRes.json().catch(() => ({})), aRes.json().catch(() => ({}))]);
      if (!oRes.ok) throw new Error(o.error ?? "Could not load orders");
      const list: Order[] = o.orders ?? [];
      setOrders(list);
      setCounts(o.counts ?? {});
      setSalesmen(o.salesmen ?? []);
      setAgents(aRes.ok ? (a.agents ?? []) : []);
      setLoadError(null);
      // Opened from a link to one order (dashboard): show it straight away.
      if (!loaded && typeof initialQ === "string") {
        const hit = list.filter((x) => x.orderNumber.toLowerCase() === initialQ.trim().toLowerCase());
        if (hit.length === 1) setSelectedId(hit[0].id);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load orders");
    }
    setLoaded(true);
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setActionError({ id, message: data.error ?? "Something went wrong" });
      else if (data.note) setActionError({ id, message: data.note, ok: true });
    } catch {
      setActionError({ id, message: "Network error. Try again." });
    }
    await load();
    setBusyId(null);
  }

  const actions = {
    advance: (id: string) => send(id, `/api/orders/${id}/status`, "PATCH", { action: "advance" }),
    approveCredit: (id: string) => send(id, `/api/orders/${id}/status`, "PATCH", { action: "approve_credit" }),
    cancel: (id: string) => send(id, `/api/orders/${id}/status`, "PATCH", { action: "cancel" }),
    assign: (id: string, deliveryAgentId: string) => {
      if (deliveryAgentId) send(id, `/api/orders/${id}/assign-delivery`, "POST", { deliveryAgentId });
    },
    salesman: (id: string, salesmanId: string | null) => send(id, `/api/orders/${id}/salesman`, "POST", { salesmanId }),
  };

  const needle = q.trim().toLowerCase();
  const shown = needle
    ? orders.filter((o) => o.orderNumber.toLowerCase().includes(needle) || o.retailer.outletName.toLowerCase().includes(needle))
    : orders;
  const selected = orders.find((o) => o.id === selectedId) ?? null;
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);
  const shownValue = shown.filter((o) => o.status !== "CANCELLED").reduce((a, o) => a + o.totalAmount, 0);

  return (
    <div className="space-y-4">
      <div className="page-head">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-sub num">
            {loaded ? `${shown.length} shown · ${formatINR(shownValue, { whole: true })}` : "Loading…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/dispatch" className="btn btn-outline btn-sm">
            <Icon name="truck" className="h-4 w-4" /> Dispatch board
          </Link>
        </div>
      </div>

      <div role="tablist" aria-label="Order status" className="no-scrollbar flex gap-1 sm:gap-5 overflow-x-auto border-b border-[var(--app-line-2)] -mx-4 px-4 md:mx-0 md:px-0">
        {FILTERS.map((f) => {
          const on = filter === f;
          const n = f === "ALL" ? total : (counts[f] ?? 0);
          return (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setFilter(f);
                setSelectedId(null);
              }}
              className={`shrink-0 inline-flex items-center gap-2 min-h-[44px] px-2 sm:px-0.5 border-b-2 -mb-px text-sm font-semibold transition ${
                on ? "border-[var(--kesar-mid)] text-ink" : "border-transparent text-[var(--muted)] hover:text-ink"
              }`}
            >
              {f === "ALL" ? "All" : t(`status.${f}`)}
              <span className={`rounded-full px-2 py-px text-xs num ${on ? "bg-[var(--kesar-tint)] text-[var(--kesar-text)]" : "bg-[#eef2f1]"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      <label className="flex items-center gap-2 max-w-md h-11 px-3 rounded-[10px] border border-[var(--app-line-2)] bg-white text-[var(--muted)] focus-within:border-[var(--mor)] focus-within:ring-[3px] focus-within:ring-[var(--mint-tint)]">
        <Icon name="search" className="h-[18px] w-[18px] shrink-0" />
        <input
          type="search"
          placeholder="Search order number or shop"
          aria-label="Search orders"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-ink text-[15px] outline-none"
        />
      </label>

      {loadError && <p className="text-sm text-[#a8281e]">{loadError}</p>}

      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-5 xl:items-start">
        <div className="min-w-0">
          {/* PC: table. */}
          <div className="hidden lg:block card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="dt min-w-[600px]">
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Shop</th>
                    <th scope="col" className="!text-right hidden 2xl:table-cell">Items</th>
                    <th scope="col" className="!text-right">Amount</th>
                    <th scope="col" className="hidden 2xl:table-cell">Delivery</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="!text-right">Placed</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((o) => {
                    const on = o.id === selectedId;
                    const held = o.creditHold && !o.creditApprovedAt && o.status !== "DELIVERED" && o.status !== "CANCELLED";
                    return (
                      <tr key={o.id} onClick={() => setSelectedId(o.id)} className={`cursor-pointer ${on ? "!bg-[#fdf3ec]" : ""}`}>
                        <td className="whitespace-nowrap">
                          <button type="button" onClick={() => setSelectedId(o.id)} className="font-semibold num hover:underline" aria-pressed={on}>
                            {o.orderNumber}
                          </button>
                        </td>
                        <td>
                          <span className="flex items-center gap-2 font-semibold">
                            {o.retailer.outletName}
                            {o.spot && <span className="chip chip-genda !py-0 !text-[11px]">Spot</span>}
                            {held && (
                              <span className="text-[#a8281e]" title="Credit hold">
                                <Icon name="lock" className="h-3.5 w-3.5" />
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-[var(--muted)]">{o.retailer.area.name}</span>
                        </td>
                        <td className="text-right text-[var(--ink-2)] num hidden 2xl:table-cell">{o.items.length}</td>
                        <td className="text-right font-semibold num whitespace-nowrap">{formatINR(o.totalAmount)}</td>
                        <td className="text-[var(--ink-2)] hidden 2xl:table-cell">{o.delivery?.deliveryAgent.user.name ?? "—"}</td>
                        <td>
                          <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR[o.status]}`}>{t(`status.${o.status}`)}</span>
                        </td>
                        <td className="text-right text-[var(--muted)] num whitespace-nowrap">{fmtTime(o.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Phone and tablet: cards. */}
          <ul className="lg:hidden space-y-2.5">
            {shown.map((o) => {
              const held = o.creditHold && !o.creditApprovedAt && o.status !== "DELIVERED" && o.status !== "CANCELLED";
              return (
                <li key={o.id}>
                  <button type="button" onClick={() => setSelectedId(o.id)} className="card w-full text-left p-3.5 sm:p-4 flex flex-col gap-2 active:bg-[#f8faf9]">
                    <span className="flex items-start gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold truncate">{o.retailer.outletName}</span>
                        <span className="block text-xs text-[var(--muted)] truncate num">
                          {o.orderNumber} · {o.retailer.area.name} · {fmtTime(o.createdAt)}
                        </span>
                      </span>
                      <span className="font-bold num whitespace-nowrap">{formatINR(o.totalAmount, { whole: true })}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[o.status]}`}>{t(`status.${o.status}`)}</span>
                      {o.spot && <span className="chip chip-genda !py-0 !text-[11px]">Spot sale</span>}
                      {held && <span className="chip !py-0 !text-[11px] !bg-[#fde4e1] !text-[#a8281e] !border-transparent">Credit hold</span>}
                      <span className="flex-1" />
                      <span className="text-xs text-[var(--muted)]">
                        {o.items.length} {o.items.length === 1 ? "item" : "items"}
                        {o.delivery?.deliveryAgent ? ` · ${o.delivery.deliveryAgent.user.name}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {loaded && shown.length === 0 && !loadError && (
            <p className="card px-5 py-8 text-center text-sm text-[var(--muted)]">{needle ? "No orders match this search." : "No orders in this filter."}</p>
          )}
        </div>

        {selected ? (
          <OrderPanel
            key={selected.id}
            order={selected}
            agents={agents}
            salesmen={salesmen}
            busy={busyId === selected.id}
            error={actionError?.id === selected.id && !actionError.ok ? actionError.message : null}
            note={actionError?.id === selected.id && actionError.ok ? actionError.message : null}
            actions={actions}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <aside className="hidden xl:flex card sticky top-20 flex-col items-center gap-2 px-6 py-10 text-center text-sm text-[var(--muted)]">
            <Icon name="box" className="h-7 w-7 text-[#9aaeaa]" />
            Pick an order to see its items and move it on.
          </aside>
        )}
      </div>
    </div>
  );
}

/** Items, totals and actions for one order: a side panel on wide screens, a full sheet below. */
function OrderPanel({
  order: o,
  agents,
  salesmen,
  busy,
  error,
  note,
  actions,
  onClose,
}: {
  order: Order;
  agents: Agent[];
  salesmen: Salesman[];
  busy: boolean;
  error: string | null;
  note: string | null;
  actions: {
    advance: (id: string) => void;
    approveCredit: (id: string) => void;
    cancel: (id: string) => void;
    assign: (id: string, agentId: string) => void;
    salesman: (id: string, salesmanId: string | null) => void;
  };
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const upcoming = nextStatus(o.status);
  const open = o.status !== "DELIVERED" && o.status !== "CANCELLED";
  const held = o.creditHold && !o.creditApprovedAt;
  const approved = o.creditHold && !!o.creditApprovedAt;
  const at = STEPS.indexOf(o.status);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end xl:sticky xl:inset-auto xl:z-auto xl:block xl:top-20" role="dialog" aria-label={`Order ${o.orderNumber}`}>
      <button type="button" className="xl:hidden absolute inset-0 bg-[rgba(8,38,37,.45)]" aria-label="Close" onClick={onClose} />
      <section className="relative w-full sm:max-w-[440px] h-full overflow-y-auto overscroll-contain bg-white xl:max-w-none xl:h-auto xl:max-h-[calc(100vh-6rem)] xl:rounded-[14px] xl:border xl:border-[var(--app-line)]">
        <div className="sticky top-0 z-10 bg-white flex items-start gap-3 px-5 pt-5 pb-4 border-b border-[#eef2f1]">
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-[var(--muted)] num">
              {o.orderNumber} · {fmtTime(o.createdAt)}
            </p>
            <h2 className="font-heading text-xl font-bold leading-tight break-words">{o.retailer.outletName}</h2>
            <p className="text-[13px] text-[var(--muted)]">{o.retailer.area.name}</p>
          </div>
          <button type="button" onClick={onClose} className="grid place-items-center h-10 w-10 shrink-0 rounded-[10px] border border-[var(--app-line-2)] text-[var(--ink-2)] hover:bg-[#f8faf9]" aria-label="Close order">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {o.status === "CANCELLED" ? (
            <span className={`inline-block text-xs px-2.5 py-1 rounded-full ${STATUS_COLOR.CANCELLED}`}>{t("status.CANCELLED")}</span>
          ) : (
            <ol className="flex gap-1" aria-label="Progress">
              {STEPS.map((s, i) => (
                <li key={s} className="flex-1 min-w-0 flex flex-col gap-1.5" aria-current={i === at ? "step" : undefined}>
                  <span className={`h-1 rounded-full ${i <= at ? (i === at ? "bg-[var(--kesar)]" : "bg-[var(--mor)]") : "bg-[var(--app-line-2)]"}`} />
                  <span className={`text-[11px] font-semibold leading-tight ${i <= at ? "text-ink" : "text-[var(--muted)]"}`}>{t(`status.${s}`)}</span>
                </li>
              ))}
            </ol>
          )}

          {(o.spot || (held && open) || (approved && open) || o.walletHold > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {o.spot && <span className="chip chip-genda">Spot sale</span>}
              {held && open && <span className="chip chip-kesar !whitespace-normal">Credit hold{o.creditHoldReason ? `: ${o.creditHoldReason}` : ""}</span>}
              {approved && open && <span className="chip chip-mint">Credit approved</span>}
              {o.walletHold > 0 && <span className="text-xs text-[var(--muted)]">Wallet {formatINR(o.walletHold)} reserved</span>}
            </div>
          )}

          {o.delivery?.deliveryAgent && (
            <div className="flex items-center gap-3 rounded-xl bg-[#fdf3ec] px-3.5 py-3">
              <span className="icon-tile !h-9 !w-9 !rounded-[10px] bg-[var(--kesar-tint)] text-[var(--kesar-text)]">
                <Icon name="truck" className="!h-[18px] !w-[18px]" />
              </span>
              <span className="text-sm">
                <span className="block font-semibold">{o.delivery.deliveryAgent.user.name}</span>
                <span className="block text-xs text-[var(--muted)]">Delivery agent</span>
              </span>
            </div>
          )}

          {open && (
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-2">
                {held ? (
                  <button disabled={busy} onClick={() => actions.approveCredit(o.id)} className="btn btn-mor btn-sm flex-1">
                    Approve credit
                  </button>
                ) : o.status === "OUT_FOR_DELIVERY" ? (
                  <p className="text-sm font-medium text-[var(--ink-2)]">With the delivery agent</p>
                ) : (
                  upcoming &&
                  upcoming !== "OUT_FOR_DELIVERY" &&
                  upcoming !== "DELIVERED" && (
                    <button disabled={busy} onClick={() => actions.advance(o.id)} className="btn btn-kesar btn-sm flex-1">
                      Mark {t(`status.${upcoming}`)}
                    </button>
                  )
                )}
                <button disabled={busy} onClick={() => actions.cancel(o.id)} className="btn btn-danger btn-sm">
                  Cancel order
                </button>
              </div>
              {o.status !== "OUT_FOR_DELIVERY" && (
                <label className="block">
                  <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Delivery agent</span>
                  <select className="input !py-2.5" value="" disabled={busy || held} onChange={(e) => actions.assign(o.id, e.target.value)}>
                    <option value="" disabled>
                      {held ? "Approve credit to assign" : "Assign delivery agent…"}
                    </option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.user.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {o.status !== "CANCELLED" && (
            <label className="block">
              <span className="block text-xs font-semibold text-[var(--muted)] mb-1">Salesman</span>
              <select
                className="input !py-2.5"
                value={o.salesmanId ?? ""}
                disabled={busy}
                onChange={(e) => actions.salesman(o.id, e.target.value || null)}
              >
                <option value="">No salesman</option>
                {/* Someone no longer active still shows while the order is theirs. */}
                {o.salesmanId && !salesmen.some((s) => s.id === o.salesmanId) && <option value={o.salesmanId}>Former salesman</option>}
                {salesmen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-[var(--muted)] mt-1">Printed on the bill and used in the salesman-wise outstanding.</span>
            </label>
          )}

          {error && (
            <p className="text-sm text-[#a8281e]" role="alert">
              {error}
            </p>
          )}
          {note && <p className="text-sm text-[var(--mint-text)]">{note}</p>}

          <div>
            <h3 className="text-xs font-bold uppercase tracking-[.05em] text-[var(--muted)] mb-2">
              Items · {o.items.length}
            </h3>
            <OrderLines items={o.items} order={o} />
          </div>

          {o.invoices?.[0] && (
            <Link href={`/admin/invoices/${o.invoices[0].id}`} className="btn btn-outline btn-sm w-full">
              <Icon name="receipt" className="h-4 w-4" /> Invoice {o.invoices[0].number}
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
