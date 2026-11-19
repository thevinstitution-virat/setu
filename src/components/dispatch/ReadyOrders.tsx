"use client";

import { useMemo } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { failLabel, plural, shortDay, type ReadyOrder } from "@/components/dispatch/kit";

type Area = { id: string; name: string; orders: ReadyOrder[] };

/** Orders ready to go, grouped by area, with checkboxes (select all per area). */
export default function ReadyOrders({
  orders,
  date,
  selected,
  onChange,
}: {
  orders: ReadyOrder[];
  date: string;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const areas = useMemo(() => {
    const map = new Map<string, Area>();
    for (const o of orders) {
      const a = map.get(o.retailer.area.id) ?? { id: o.retailer.area.id, name: o.retailer.area.name, orders: [] };
      a.orders.push(o);
      map.set(a.id, a);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [orders]);

  if (orders.length === 0) {
    return (
      <div className="card p-6 text-center space-y-1">
        <p className="text-sm font-semibold">Nothing waiting to go out</p>
        <p className="text-sm text-[var(--muted)]">Orders due on or before this day show here once they are placed, and not on an open trip.</p>
      </div>
    );
  }

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {areas.map((a) => {
        const ids = a.orders.map((o) => o.id);
        const all = ids.every((id) => selected.has(id));
        const some = !all && ids.some((id) => selected.has(id));
        const value = a.orders.reduce((s, o) => s + o.total, 0);
        return (
          <section key={a.id} className="card overflow-hidden">
            <label className="flex items-center gap-3 px-4 py-3 border-b border-[var(--line)] cursor-pointer min-h-[52px]">
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-[var(--mor)]"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = some;
                }}
                onChange={(e) => toggle(ids, e.target.checked)}
                aria-label={`Select all orders in ${a.name}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-heading font-bold truncate">{a.name}</span>
                <span className="block text-xs text-[var(--muted)]">
                  {plural(a.orders.length, "order")} · {formatINR(value)}
                </span>
              </span>
              <span className="text-xs font-semibold text-[var(--ink-2)] shrink-0">{all ? "Clear" : "Select all"}</span>
            </label>
            <ul className="divide-y divide-[var(--line)]">
              {a.orders.map((o) => (
                <li key={o.id}>
                  <OrderRow o={o} date={date} checked={selected.has(o.id)} onToggle={(on) => toggle([o.id], on)} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function OrderRow({ o, date, checked, onToggle }: { o: ReadyOrder; date: string; checked: boolean; onToggle: (on: boolean) => void }) {
  const late = o.deliveryDate && o.deliveryDate < date;
  return (
    <label className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition ${checked ? "bg-[var(--mint-tint)]" :"hover:bg-black/[0.03]"}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mor)]"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={`Select ${o.orderNumber}`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-sm font-semibold truncate">{o.retailer.outletName}</span>
            <span className="block text-xs text-[var(--muted)] truncate">
              {o.orderNumber} · {plural(o.lines, "line")} · PIN {o.retailer.pinCode}
            </span>
          </span>
          <span className="text-sm font-semibold shrink-0">{formatINR(o.total)}</span>
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          {o.status === "PLACED" && <span className="chip chip-genda !py-0.5 !px-2 !text-[11px]">Not confirmed</span>}
          {o.status === "CONFIRMED" && <span className="chip !py-0.5 !px-2 !text-[11px]">Not packed</span>}
          {o.retry && (
            <span className="chip chip-kesar !py-0.5 !px-2 !text-[11px] max-w-full">
              <span className="truncate">Tried before: {failLabel(o.retry.reason)}</span>
            </span>
          )}
          {late && <span className="chip !py-0.5 !px-2 !text-[11px]">Was due {shortDay(o.deliveryDate!)}</span>}
          {!o.retailer.located && (
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
              <Icon name="pin" className="h-3 w-3" /> No map pin
            </span>
          )}
        </span>
      </span>
    </label>
  );
}

/** Link to the admin orders screen, filtered to one order number. */
export function OrderLink({ orderNumber, className = "" }: { orderNumber: string; className?: string }) {
  return (
    <Link href={`/admin/orders?q=${encodeURIComponent(orderNumber)}`} className={`font-semibold text-[var(--kesar-text)] hover:underline ${className}`}>
      {orderNumber}
    </Link>
  );
}
