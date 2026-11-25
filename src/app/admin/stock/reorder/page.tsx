"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import StockNav from "@/components/stock/StockNav";
import { formatINR } from "@/lib/money";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";

type Row = {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  caseSize: number | null;
  available: number;
  onOrder: number;
  reorderLevel: number;
  suggested: number;
  supplierId: string | null;
  supplierName: string | null;
  lastCost: number | null;
};

type Drafted = { orders: { id: string; number: string; lines: number }[]; skipped: string[] };

const plural = (n: number, w: string, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;

export default function ReorderPage() {
  const { data, error, reload } = useFetch<{ rows: Row[] }>("/api/stock/reorder");
  // Everything is ticked by default: keep the ones the user unticked.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [done, setDone] = useState<Drafted | null>(null);

  const rows = data?.rows ?? [];
  const orderable = rows.filter((r) => r.suggested > 0);
  const ticked = orderable.filter((r) => !unticked.has(r.productId));

  const groups = new Map<string, { name: string | null; rows: Row[] }>();
  for (const r of rows) {
    const k = r.supplierId ?? "";
    const g = groups.get(k) ?? { name: r.supplierName, rows: [] };
    g.rows.push(r);
    groups.set(k, g);
  }
  const ordered = [...groups.entries()].sort(([a, ga], [b, gb]) => (a === "" ? 1 : b === "" ? -1 : (ga.name ?? "").localeCompare(gb.name ?? "")));

  function toggle(ids: string[], on: boolean) {
    setUnticked((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.delete(id);
        else n.add(id);
      }
      return n;
    });
  }

  async function draft() {
    if (!ticked.length) return;
    setBusy(true);
    setFailed(null);
    try {
      const r = await send<{ result: Drafted }>("/api/purchase-orders/reorder", "POST", { productIds: ticked.map((t) => t.productId) });
      setDone(r.result);
      setUnticked(new Set());
      reload();
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const value = ticked.reduce((a, r) => a + r.suggested * (r.lastCost ?? 0), 0);

  return (
    <div className="space-y-5 pb-36">
      <div className="space-y-3">
        <div className="page-head">
          <div className="min-w-0">
            <p className="page-kick">Stock</p>
            <h1 className="page-title">Reorder</h1>
            <p className="page-sub">Products at or below their reorder level. Tick what to order and draft the purchase orders.</p>
          </div>
        </div>
        <StockNav />
      </div>

      {done && <DraftResult done={done} onClose={() => setDone(null)} />}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {data && rows.length === 0 && (
        <div className="card p-6 text-center space-y-1">
          <p className="text-sm font-semibold">Nothing to reorder</p>
          <p className="text-sm text-[var(--muted)]">Products show up here when their available stock falls to the reorder level set on the product.</p>
        </div>
      )}

      {ordered.map(([key, g]) => {
        const can = g.rows.filter((r) => r.suggested > 0);
        const allOn = can.length > 0 && can.every((r) => !unticked.has(r.productId));
        return (
          <section key={key || "none"} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-[var(--line)]">
              <div className="min-w-0">
                <h2 className="font-heading font-bold break-words">{g.name ?? "No usual supplier"}</h2>
                <p className="text-xs text-[var(--muted)]">
                  {key ? plural(g.rows.length, "product") : "Set a usual supplier on these products to order them here."}
                </p>
              </div>
              {can.length > 1 && (
                <button type="button" className="btn btn-quiet btn-xs !min-h-[40px]" onClick={() => toggle(can.map((r) => r.productId), !allOn)}>
                  {allOn ? "Untick all" : "Tick all"}
                </button>
              )}
            </div>
            <ul className="divide-y divide-[var(--line)]">
              {g.rows.map((r) => (
                <ReorderRow key={r.productId} r={r} on={r.suggested > 0 && !unticked.has(r.productId)} onToggle={(on) => toggle([r.productId], on)} />
              ))}
            </ul>
          </section>
        );
      })}

      {orderable.length > 0 && (
        <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
          <div className="card p-3 shadow-xl space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  {plural(ticked.length, "product")} ticked
                  {value > 0 ? ` · about ${formatINR(value, { whole: true })}` : ""}
                </p>
                <p className="text-xs text-[var(--muted)]">One draft per supplier, at the suggested quantities. You can change them before sending.</p>
              </div>
              <button type="button" className="btn btn-kesar w-full sm:w-auto" disabled={busy || ticked.length === 0} onClick={draft}>
                <Icon name="clipboard" className="h-4 w-4" /> {busy ? "Drafting…" : "Draft purchase orders"}
              </button>
            </div>
            {failed && <p className="text-sm text-[var(--risk-text)]">{failed}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function ReorderRow({ r, on, onToggle }: { r: Row; on: boolean; onToggle: (on: boolean) => void }) {
  const can = r.suggested > 0;
  const cases = r.caseSize && r.caseSize > 1 && r.suggested % r.caseSize === 0 ? r.suggested / r.caseSize : null;
  return (
    <li>
      <label className={`flex items-start gap-3 px-4 py-3 min-h-[56px] ${can ? "cursor-pointer hover:bg-black/[0.03]" : "opacity-70"}`}>
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 accent-[var(--kesar)]"
          checked={on}
          disabled={!can}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Order ${r.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <p className="text-sm font-semibold break-words">{r.name}</p>
              <p className="text-xs text-[var(--muted)] break-all">{r.sku}</p>
            </div>
            <div className="text-right shrink-0">
              {can ? (
                <>
                  <p className="text-sm font-bold text-[var(--accent-text)]">
                    Order {r.suggested} {r.unit}
                  </p>
                  {cases !== null && <p className="text-[11px] text-[var(--muted)]">{plural(cases, "case")}</p>}
                </>
              ) : (
                <p className="text-xs font-semibold text-[var(--success-text)]">Enough on order</p>
              )}
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11.5px]">
            <span className={`chip !py-0.5 !px-2 !text-[11.5px] ${r.available <= 0 ? "st-cancelled" : "chip-genda"}`}>
              {r.available} {r.unit} available
            </span>
            <span className="chip !py-0.5 !px-2 !text-[11.5px]">Reorder at {r.reorderLevel}</span>
            {r.onOrder > 0 && <span className="chip !py-0.5 !px-2 !text-[11.5px]">{r.onOrder} on order</span>}
            {r.lastCost !== null && <span className="chip !py-0.5 !px-2 !text-[11.5px]">Last cost {formatINR(r.lastCost)}</span>}
          </div>
        </div>
      </label>
    </li>
  );
}

function DraftResult({ done, onClose }: { done: Drafted; onClose: () => void }) {
  return (
    <section className="card p-4 space-y-3" role="status">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading font-bold flex items-center gap-2">
          <Icon name="check" className="h-5 w-5 text-[var(--success-text)]" />
          {done.orders.length ? `${plural(done.orders.length, "draft purchase order")} made` : "No purchase orders made"}
        </p>
        <button type="button" className="btn btn-quiet btn-xs !px-2 !min-h-[40px] !min-w-[40px]" aria-label="Close" onClick={onClose}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      {done.orders.length > 0 && (
        <ul className="space-y-1.5">
          {done.orders.map((o) => (
            <li key={o.id}>
              <Link href={`/admin/stock/purchase-orders/${o.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-ink/5 px-3 py-2.5 min-h-[44px]">
                <span className="text-sm font-semibold break-all">{o.number}</span>
                <span className="flex items-center gap-1 text-xs text-[var(--muted)] shrink-0">
                  {plural(o.lines, "line")} <Icon name="chevronRight" className="h-4 w-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {done.orders.length > 0 && <p className="text-xs text-[var(--muted)]">Check each draft, then mark it sent and share it with the supplier.</p>}
      {done.skipped.length > 0 && (
        <div className="rounded-2xl bg-[var(--scheme-tint)] p-3 text-sm space-y-1">
          <p className="font-semibold text-[var(--scheme-text)]">Skipped: no usual supplier</p>
          <p className="text-[var(--ink-2)]">{done.skipped.join(", ")}</p>
          <p className="text-xs text-[var(--ink-2)]">
            Set a usual supplier on the product in{" "}
            <Link href="/admin/products" className="font-semibold underline">
              Products
            </Link>
            , then draft again.
          </p>
        </div>
      )}
    </section>
  );
}
