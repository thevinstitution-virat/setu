"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { formatINR } from "@/lib/money";
import { ErrorBox, shortDate, useFetch } from "@/components/admin/AdminKit";

type Purchase = {
  id: string;
  number: string;
  supplier: { id: string; name: string };
  location: { name: string };
  po: { id: string; number: string } | null;
  billNo: string | null;
  billDate: string | null;
  total: number;
  createdAt: string;
  _count: { lines: number };
};

type Supplier = { id: string; name: string; active: boolean };

/** @db.Date ISO → "20 Nov 2026". */
const dayText = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

export default function PurchasesPage() {
  const [supplierId, setSupplierId] = useState("");
  const { data, error, reload } = useFetch<{ purchases: Purchase[] }>(`/api/purchases${supplierId ? `?supplierId=${supplierId}` : ""}`);
  const suppliers = useFetch<{ suppliers: Supplier[] }>("/api/suppliers");
  const list = data?.purchases ?? [];
  const supplierList = suppliers.data?.suppliers ?? [];

  return (
    <div className="space-y-5 pb-28">
      <div className="space-y-3">
        <div className="page-head">
          <div className="min-w-0">
            <p className="page-kick">Stock</p>
            <h1 className="page-title">Goods received</h1>
            <p className="page-sub">Every delivery from your suppliers, newest first.</p>
          </div>
          <Link href="/admin/stock/receive" className="btn btn-kesar btn-sm !min-h-[44px]">
            <Icon name="download" className="h-4 w-4" /> Receive goods
          </Link>
        </div>
        <StockNav />
      </div>

      {supplierList.length > 1 && (
        <select className="input sm:max-w-xs" aria-label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">All suppliers</option>
          {supplierList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.active ? "" : " (off)"}
            </option>
          ))}
        </select>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && list.length === 0 && (
        <div className="card p-6 text-center space-y-2">
          <p className="text-sm font-semibold">{supplierId ? "Nothing received from this supplier yet" : "Nothing received yet"}</p>
          <p className="text-sm text-[var(--muted)]">When goods come in, record them under Receive goods. Stock goes up batch by batch.</p>
        </div>
      )}

      {list.length > 0 && (
        <div className="card overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_5rem_7.5rem] gap-3 px-4 py-2 text-xs font-semibold text-[var(--muted)] border-b border-[var(--line)]">
            <span>Number</span>
            <span>Supplier</span>
            <span>Bill</span>
            <span className="text-right">Lines</span>
            <span className="text-right">Cost</span>
          </div>
          <ul className="divide-y divide-[var(--line)]">
            {list.map((p) => {
              const bill = p.billNo ? `Bill ${p.billNo}${p.billDate ? ` · ${dayText(p.billDate)}` : ""}` : "";
              return (
                <li key={p.id}>
                  <Link href={`/admin/stock/purchases/${p.id}`} className="block px-4 py-3 hover:bg-black/[0.03] transition">
                    {/* Phone */}
                    <div className="md:hidden flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm break-all">{p.number}</p>
                        <p className="text-sm truncate">{p.supplier.name}</p>
                        <p className="text-xs text-[var(--muted)]">
                          {shortDate(p.createdAt)}
                          {bill ? ` · ${bill}` : ""}
                        </p>
                        {p.po && <p className="text-xs text-[var(--muted)]">Order {p.po.number}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-sm">{p.total ? formatINR(p.total) : "—"}</p>
                        <p className="text-[11px] text-[var(--muted)]">
                          {p._count.lines} line{p._count.lines === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                    {/* Desktop */}
                    <div className="hidden md:grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_5rem_7.5rem] gap-3 items-center text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{p.number}</p>
                        <p className="text-xs text-[var(--muted)]">{shortDate(p.createdAt)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate">{p.supplier.name}</p>
                        <p className="text-xs text-[var(--muted)] truncate">
                          {p.location.name}
                          {p.po ? ` · Order ${p.po.number}` : ""}
                        </p>
                      </div>
                      <span className="text-[var(--ink-2)] truncate">{bill || "—"}</span>
                      <span className="text-right text-[var(--ink-2)]">{p._count.lines}</span>
                      <span className="text-right font-semibold">{p.total ? formatINR(p.total) : "—"}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {list.length >= 100 && <p className="text-xs text-[var(--muted)]">Showing the latest 100.</p>}
    </div>
  );
}
