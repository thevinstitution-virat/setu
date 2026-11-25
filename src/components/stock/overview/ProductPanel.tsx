"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, Flash, Sheet, useFetch } from "@/components/admin/AdminKit";
import AdjustSheet from "@/components/stock/overview/AdjustSheet";
import DamageSheet from "@/components/stock/overview/DamageSheet";
import { KIND_LABEL, MoveRow, SMALL_CHIP, caseText, expiryInfo, qtyText, type Lot, type Move, type Place, type StockRow } from "@/components/stock/overview/kit";

type Mode = "detail" | "adjust" | "damage";

/**
 * One product's stock: numbers, batches (first expiry first), recent history,
 * and the Adjust / Move to damaged sheets (shown in place of the detail).
 */
export default function ProductPanel({
  product,
  alertDays,
  onClose,
  onChanged,
}: {
  product: StockRow;
  alertDays: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode>("detail");
  const [flash, setFlash] = useState<string | null>(null);
  const lots = useFetch<{ lots: Lot[] }>(`/api/stock/lots?productId=${product.id}`);
  const moves = useFetch<{ moves: Move[]; next: string | null }>(`/api/stock/moves?productId=${product.id}`);
  const places = useFetch<{ locations: Place[] }>(mode === "detail" ? null : "/api/stock/locations");

  function done(text: string) {
    setMode("detail");
    setFlash(text);
    lots.reload();
    moves.reload();
    onChanged();
  }

  if (mode !== "detail") {
    const back = () => setMode("detail");
    if (places.error || lots.error) {
      return (
        <Sheet title={product.name} onClose={back}>
          <ErrorBox message={places.error ?? lots.error ?? ""} onRetry={places.error ? places.reload : lots.reload} />
        </Sheet>
      );
    }
    if (!places.data || !lots.data) {
      return (
        <Sheet title={product.name} onClose={back}>
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        </Sheet>
      );
    }
    return mode === "adjust" ? (
      <AdjustSheet product={product} lots={lots.data.lots} places={places.data.locations} onClose={back} onDone={done} />
    ) : (
      <DamageSheet product={product} lots={lots.data.lots} places={places.data.locations} onClose={back} onDone={done} />
    );
  }

  const sellable = (lots.data?.lots ?? []).filter((l) => l.location.kind !== "DAMAGED").reduce((a, l) => a + l.qty, 0);
  const cases = caseText(product.available, product);

  return (
    <Sheet
      title={product.name}
      onClose={onClose}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-kesar" onClick={() => setMode("adjust")}>
            <Icon name="edit" className="h-4 w-4" /> Adjust stock
          </button>
          <button type="button" className="btn btn-outline" onClick={() => setMode("damage")} disabled={lots.data !== null && sellable === 0}>
            <Icon name="alert" className="h-4 w-4" /> Move to damaged
          </button>
        </div>
      }
    >
      <p className="text-sm text-[var(--muted)] -mt-1">
        {product.sku}
        {product.category ? ` · ${product.category.name}` : ""}
      </p>
      <Flash text={flash} />

      <section className="card p-4 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Available to sell</p>
            <p className={`stat-num mt-1 ${product.available <= 0 ? "text-[var(--risk-text)]" : ""}`}>{qtyText(product.available, product.unit)}</p>
            {cases && <p className="text-xs text-[var(--muted)] mt-1">= {cases}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5 justify-end">
            {product.out && <span className={`chip ${SMALL_CHIP} !bg-[var(--risk-tint)] !text-[var(--risk-text)] !border-transparent`}>Out</span>}
            {product.low && !product.out && <span className={`chip chip-genda ${SMALL_CHIP}`}>Reorder</span>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Num n={product.warehouse} label="Warehouse" />
          <Num n={product.van} label="In vans" />
          <Num n={product.reserved} label="On open orders" />
          <Num n={product.damaged} label="Damaged" tone={product.damaged ? "text-[var(--accent-text)]" : ""} />
          <Num n={product.expired} label="Expired" tone={product.expired ? "text-[var(--risk-text)]" : ""} />
          <div className="rounded-xl bg-ink/5 py-2 px-1 min-w-0">
            <p className="font-heading font-bold text-sm leading-tight break-words">{formatINR(product.value)}</p>
            <p className="text-[10.5px] text-[var(--muted)] mt-1 leading-tight">Stock value</p>
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">
          {product.reorderLevel !== null ? `Reorder at ${qtyText(product.reorderLevel, product.unit)}` : "No reorder level set"}
          {product.reorderQty ? ` · order ${qtyText(product.reorderQty, product.unit)}` : ""}
          {product.supplier ? ` · from ${product.supplier.name}` : ""}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-heading font-bold">Batches</h3>
        {lots.error && <ErrorBox message={lots.error} onRetry={lots.reload} />}
        {!lots.data && !lots.error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {lots.data && lots.data.lots.length === 0 && <p className="card p-4 text-sm text-[var(--muted)]">No stock of this product anywhere.</p>}
        {lots.data && lots.data.lots.length > 0 && (
          <ul className="card divide-y divide-[var(--line)] overflow-hidden">
            {lots.data.lots.map((l) => {
              const ex = l.expiry ? expiryInfo(l.expiry, alertDays) : null;
              return (
                <li key={l.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold break-words">
                      {l.location.name}{" "}
                      <span className={`chip ${SMALL_CHIP} ${l.location.kind === "DAMAGED" ? "chip-kesar" : ""}`}>{KIND_LABEL[l.location.kind]}</span>
                    </p>
                    <p className="text-xs text-[var(--muted)] break-words">{l.batch ? `Batch ${l.batch}` : "No batch no."}</p>
                    {ex ? <p className={`text-xs font-semibold ${ex.tone}`}>{ex.text}</p> : <p className="text-xs text-[var(--muted)]">No expiry date</p>}
                  </div>
                  <p className={`shrink-0 font-heading font-bold ${l.expired ? "text-[var(--risk-text)]" : ""}`}>{qtyText(l.qty, product.unit)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-heading font-bold">Recent history</h3>
          <Link href={`/admin/stock/history?productId=${product.id}`} className="text-sm font-bold text-[var(--accent-text)]">
            All history →
          </Link>
        </div>
        {moves.error && <ErrorBox message={moves.error} onRetry={moves.reload} />}
        {!moves.data && !moves.error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
        {moves.data && moves.data.moves.length === 0 && <p className="card p-4 text-sm text-[var(--muted)]">Nothing has moved yet.</p>}
        {moves.data && moves.data.moves.length > 0 && (
          <ul className="card divide-y divide-[var(--line)] overflow-hidden">
            {moves.data.moves.slice(0, 15).map((m) => (
              <li key={m.id}>
                <MoveRow m={m} showProduct={false} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Sheet>
  );
}

function Num({ n, label, tone = "" }: { n: number; label: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-ink/5 py-2 px-1 min-w-0">
      <p className={`font-heading font-bold text-lg leading-none ${tone}`}>{n.toLocaleString("en-IN")}</p>
      <p className="text-[10.5px] text-[var(--muted)] mt-1 leading-tight">{label}</p>
    </div>
  );
}
