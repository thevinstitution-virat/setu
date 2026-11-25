"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { ErrorBox, TabBar, shortDate, useFetch } from "@/components/admin/AdminKit";

type LoadRow = { productId: string; name: string; sku: string; unit: string; caseSize: number | null; category: string; booked: number; usual: number; extra: number; suggested: number; warehouse: number | null; short: number };
type Sheet = { date: string; label: string; orders: number; stockTracked: boolean; topUp: boolean; rows: LoadRow[]; totals: { booked: number; extra: number; short: number } };
type FcRow = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  daily: number;
  sigma: number;
  activeDays: number;
  available: number | null;
  onOrder: number;
  daysLeft: number | null;
  runsOut: string | null;
  supplierName: string | null;
  leadDays: number | null;
  reorderQty: number;
  runsOutFirst: boolean;
};
type Table = { today: string; stockTracked: boolean; coverDays: number; serviceLevel: number; rows: FcRow[] };

const TABS = [
  { key: "load", label: "Load sheet" },
  { key: "forecast", label: "Forecast" },
] as const;

const tomorrow = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
const num = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 });

/** A6: tomorrow's load sheet (orders + the usual for that weekday) and each product's demand forecast. */
export default function ForecastPage() {
  const [tab, setTab] = useState<"load" | "forecast">("load");
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="page-head">
          <div className="min-w-0">
            <p className="page-kick">Stock</p>
            <h1 className="page-title">Forecast</h1>
            <p className="page-sub">Worked out from the last 8 weeks of orders, with recent weeks counting most and each weekday&apos;s pattern. Plain maths, no AI.</p>
          </div>
          <Link href="/admin/settings/automation" className="btn btn-quiet btn-sm">
            <Icon name="settings" className="h-4 w-4" /> Settings
          </Link>
        </div>
        <StockNav />
      </div>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === "load" ? <LoadSheet /> : <ForecastTable />}
    </div>
  );
}

function LoadSheet() {
  const [date, setDate] = useState(tomorrow);
  const { data, error, reload } = useFetch<Sheet>(`/api/stock/load-sheet?date=${date}`);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-[var(--muted)]">Day</span>
          <input type="date" className="input !w-auto" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <a className="btn btn-outline btn-sm" href={`/api/stock/load-sheet?date=${date}&format=csv`}>
          <Icon name="download" className="h-4 w-4" /> CSV
        </a>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.print()}>
          Print
        </button>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <>
          <p className="text-sm text-[var(--muted)]">
            {data.label}: {data.orders} order{data.orders === 1 ? "" : "s"} going out
            {data.topUp ? `; extra brings each product up to the usual for a ${data.label.split(",")[0]} (spot sales, late orders)` : ""}.
            {data.totals.short > 0 && <span className="font-semibold text-[var(--risk-text)]"> {data.totals.short} short in the warehouse.</span>}
          </p>
          {data.rows.length === 0 ? (
            <p className="card p-4 text-sm text-[var(--muted)]">Nothing to load for this day yet.</p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 560 }}>
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="px-3 py-2 text-left font-semibold">Product</th>
                    <th className="px-3 py-2 text-right font-semibold">Booked</th>
                    <th className="px-3 py-2 text-right font-semibold" title="Usual for this weekday">Usual</th>
                    <th className="px-3 py-2 text-right font-semibold">Extra</th>
                    <th className="px-3 py-2 text-right font-semibold">Load</th>
                    {data.stockTracked && <th className="px-3 py-2 text-right font-semibold">In stock</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {data.rows.map((r, i) => (
                    <tr key={r.productId}>
                      <td className="px-3 py-2">
                        {(i === 0 || data.rows[i - 1].category !== r.category) && <span className="block text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">{r.category}</span>}
                        <span className="font-semibold">{r.name}</span> <span className="text-xs text-[var(--muted)]">{r.unit}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(r.booked)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[var(--muted)]">{num(r.usual)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.extra ? `+${num(r.extra)}` : "–"}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{num(r.suggested)}</td>
                      {data.stockTracked && (
                        <td className={`px-3 py-2 text-right tabular-nums ${r.short ? "font-semibold text-[var(--risk-text)]" : ""}`}>
                          {num(r.warehouse ?? 0)}
                          {r.short > 0 && <span className="block text-[11px]">short {num(r.short)}</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ForecastTable() {
  const { data, error, reload } = useFetch<Table>("/api/stock/forecast");
  return (
    <div className="space-y-4">
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[var(--muted)]">
              {data.stockTracked
                ? `"Order now" covers the supplier's delivery time plus ${data.coverDays} days, with safety stock so it lasts ${data.serviceLevel}% of the time. Each morning the same maths sends one reorder suggestion per supplier.`
                : "Stock tracking is off, so days left and reorder quantities can't be worked out."}
            </p>
            <a className="btn btn-outline btn-sm" href="/api/stock/forecast?format=csv">
              <Icon name="download" className="h-4 w-4" /> CSV
            </a>
          </div>
          {data.rows.length === 0 ? (
            <p className="card p-4 text-sm text-[var(--muted)]">No orders in the last 8 weeks to forecast from.</p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="border-b border-[var(--line)] text-xs text-[var(--muted)]">
                    <th className="px-3 py-2 text-left font-semibold">Product</th>
                    <th className="px-3 py-2 text-right font-semibold">A day</th>
                    <th className="px-3 py-2 text-right font-semibold">Available</th>
                    <th className="px-3 py-2 text-right font-semibold">Days left</th>
                    <th className="px-3 py-2 text-left font-semibold">Supplier</th>
                    <th className="px-3 py-2 text-right font-semibold">Order now</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--line)]">
                  {data.rows.map((r) => (
                    <tr key={r.productId}>
                      <td className="px-3 py-2">
                        <span className="font-semibold">{r.name}</span>
                        <span className="block text-[11px] text-[var(--muted)]">
                          {r.sku} · ordered on {r.activeDays} of 56 days
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {num(r.daily)} <span className="text-xs text-[var(--muted)]">{r.unit}</span>
                        <span className="block text-[11px] text-[var(--muted)]">± {num(r.sigma)}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.available === null ? "–" : num(r.available)}
                        {r.onOrder > 0 && <span className="block text-[11px] text-[var(--muted)]">+{num(r.onOrder)} on order</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.runsOutFirst ? "font-semibold text-[var(--risk-text)]" : ""}`}>
                        {r.daysLeft === null ? "–" : r.daysLeft}
                        {r.runsOut && <span className="block text-[11px] text-[var(--muted)]">{shortDate(`${r.runsOut}T00:00:00+05:30`)}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {r.supplierName ?? <span className="text-xs text-[var(--muted)]">No supplier</span>}
                        {r.leadDays !== null && <span className="block text-[11px] text-[var(--muted)]">{r.leadDays} days to deliver</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{r.reorderQty ? num(r.reorderQty) : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
