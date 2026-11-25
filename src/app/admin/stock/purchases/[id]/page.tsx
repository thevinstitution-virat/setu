"use client";

import { use } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { formatINR } from "@/lib/money";
import { ErrorBox, shortDate, useFetch } from "@/components/admin/AdminKit";

type Line = {
  id: string;
  quantity: number;
  batch: string;
  expiry: string | null;
  mfgDate: string | null;
  unitCost: number | null;
  product: { id: string; name: string; sku: string; unit: string };
};

type Purchase = {
  id: string;
  number: string;
  supplier: { id: string; name: string; gstin: string | null; phone: string | null };
  location: { id: string; name: string };
  po: { id: string; number: string } | null;
  billNo: string | null;
  billDate: string | null;
  note: string | null;
  total: number;
  createdAt: string;
  createdBy: string | null;
  lines: Line[];
};

/** @db.Date ISO → "20 Nov 2026". */
const dayText = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

export default function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, reload } = useFetch<{ purchase: Purchase }>(`/api/purchases/${id}`);

  const back = (
    <Link href="/admin/stock/purchases" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
      <Icon name="back" className="h-4 w-4" /> Goods received
    </Link>
  );

  if (!data) {
    return (
      <div className="space-y-4">
        {back}
        {error ? <ErrorBox message={error} onRetry={reload} /> : <p className="text-sm text-[var(--muted)]">Loading…</p>}
      </div>
    );
  }

  const p = data.purchase;
  const units = p.lines.reduce((a, l) => a + l.quantity, 0);

  return (
    <div className="space-y-5 pb-28">
      <div className="space-y-3">
        {back}
        <StockNav />
      </div>

      <div className="card p-4 sm:p-5 space-y-4">
        <div className="min-w-0">
          <p className="page-kick">Goods received</p>
          <h1 className="page-title break-all">{p.number}</h1>
          <p className="text-sm text-[var(--ink-2)] mt-1">
            {shortDate(p.createdAt, true)}
            {p.createdBy ? ` · by ${p.createdBy}` : ""}
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 text-sm">
          <Item label="Supplier">
            <p className="font-semibold break-words">{p.supplier.name}</p>
            {p.supplier.gstin && <p className="text-xs text-[var(--muted)] break-all">GSTIN {p.supplier.gstin}</p>}
          </Item>
          <Item label="Into">
            <p className="font-semibold">{p.location.name}</p>
          </Item>
          <Item label="Supplier bill">
            <p className="font-semibold">{p.billNo ? `${p.billNo}${p.billDate ? ` · ${dayText(p.billDate)}` : ""}` : "Not entered"}</p>
          </Item>
          <Item label="Purchase order">
            {p.po ? (
              <Link href={`/admin/stock/purchase-orders/${p.po.id}`} className="font-semibold text-[var(--accent-text)]">
                {p.po.number}
              </Link>
            ) : (
              <p className="text-[var(--muted)]">None</p>
            )}
          </Item>
        </dl>
        {p.note && <p className="rounded-xl bg-ink/5 px-3 py-2 text-sm text-[var(--ink-2)]">{p.note}</p>}
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3.5 border-b border-[var(--line)]">
          <h2 className="font-heading font-bold">Goods</h2>
          <span className="text-sm text-[var(--muted)]">{units} units</span>
        </div>
        <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6.5rem_5.5rem_6.5rem_7rem] gap-3 px-4 py-2 text-xs font-semibold text-[var(--muted)] border-b border-[var(--line)]">
          <span>Product</span>
          <span>Batch</span>
          <span>Expiry</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Cost</span>
          <span className="text-right">Amount</span>
        </div>
        <ul className="divide-y divide-[var(--line)]">
          {p.lines.map((l) => {
            const amount = l.unitCost !== null ? l.quantity * l.unitCost : null;
            return (
              <li key={l.id} className="px-4 py-3">
                {/* Phone */}
                <div className="md:hidden space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold break-words">{l.product.name}</p>
                      <p className="text-xs text-[var(--muted)] break-all">{l.product.sku}</p>
                    </div>
                    <p className="text-sm font-semibold shrink-0">{amount !== null ? formatINR(amount) : "—"}</p>
                  </div>
                  <p className="text-xs text-[var(--ink-2)]">
                    {l.quantity} {l.product.unit}
                    {l.unitCost !== null ? ` × ${formatINR(l.unitCost)}` : ""}
                  </p>
                  {(l.batch || l.expiry || l.mfgDate) && (
                    <p className="text-xs text-[var(--muted)] flex flex-wrap items-center gap-x-2">
                      <Icon name="layers" className="h-3.5 w-3.5" />
                      {l.batch && <span>Batch {l.batch}</span>}
                      {l.expiry && <span>Expiry {dayText(l.expiry)}</span>}
                      {l.mfgDate && <span>Made {dayText(l.mfgDate)}</span>}
                    </p>
                  )}
                </div>
                {/* Desktop */}
                <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_6.5rem_5.5rem_6.5rem_7rem] gap-3 items-center text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{l.product.name}</p>
                    <p className="text-xs text-[var(--muted)] truncate">{l.product.sku}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate">{l.batch || "—"}</p>
                    {l.mfgDate && <p className="text-xs text-[var(--muted)]">Made {dayText(l.mfgDate)}</p>}
                  </div>
                  <span className="text-[var(--ink-2)]">{l.expiry ? dayText(l.expiry) : "—"}</span>
                  <span className="text-right">
                    {l.quantity} <span className="text-xs text-[var(--muted)]">{l.product.unit}</span>
                  </span>
                  <span className="text-right text-[var(--ink-2)]">{l.unitCost !== null ? formatINR(l.unitCost) : "—"}</span>
                  <span className="text-right font-semibold">{amount !== null ? formatINR(amount) : "—"}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t-2 border-[var(--line)]">
          <span className="text-sm text-[var(--ink-2)]">Total before GST</span>
          <span className="font-heading font-bold text-lg">{formatINR(p.total)}</span>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link href="/admin/stock/receive" className="btn btn-outline btn-sm !min-h-[44px]">
          <Icon name="plus" className="h-4 w-4" /> Receive more goods
        </Link>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
