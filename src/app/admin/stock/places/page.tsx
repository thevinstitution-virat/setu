"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";
import StockNav from "@/components/stock/StockNav";
import { ClearDamagedSheet, TransferSheet, WarehouseSheet } from "@/components/stock/overview/PlaceSheets";
import { SMALL_CHIP, plural, qtyText, ymdText, type Lot, type Place } from "@/components/stock/overview/kit";

type Open =
  | { kind: "warehouse"; place: Place | null }
  | { kind: "transfer" }
  | { kind: "clear"; lot: Lot; to: "WRITE_OFF" | "SUPPLIER_RETURN" }
  | null;

export default function StockPlacesPage() {
  const { data, error, reload } = useFetch<{ locations: Place[] }>("/api/stock/locations");
  const [open, setOpen] = useState<Open>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const all = data?.locations ?? [];
  const warehouses = all.filter((l) => l.kind === "WAREHOUSE");
  const activeWarehouses = warehouses.filter((w) => w.active);
  const vans = all.filter((l) => l.kind === "VAN");
  const bin = all.find((l) => l.kind === "DAMAGED") ?? null;
  const binLots = useFetch<{ lots: Lot[] }>(bin ? `/api/stock/lots?locationId=${bin.id}` : null);

  function done(text: string) {
    setOpen(null);
    setFlash(text);
    reload();
    binLots.reload();
  }

  return (
    <div className="space-y-6 pb-24">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Stock</p>
          <h1 className="page-title">Places</h1>
          <p className="page-sub">Your warehouses, the vans and the damaged bin.</p>
        </div>
      </div>
      <StockNav />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {flash && (
        <p className="card p-3 text-sm font-semibold text-[var(--success-text)] bg-[var(--success-tint)] flex items-center gap-2" role="status">
          <Icon name="check" className="h-4 w-4 shrink-0" />
          <span className="min-w-0">{flash}</span>
        </p>
      )}

      {data && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading font-bold text-xl">Warehouses</h2>
              <div className="flex flex-wrap gap-2">
                {activeWarehouses.length >= 2 && (
                  <button type="button" className="btn btn-outline btn-sm !min-h-[44px]" onClick={() => setOpen({ kind: "transfer" })}>
                    <Icon name="route" className="h-4 w-4" /> Transfer
                  </button>
                )}
                <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={() => setOpen({ kind: "warehouse", place: null })}>
                  <Icon name="plus" className="h-4 w-4" /> Add warehouse
                </button>
              </div>
            </div>
            {warehouses.length === 0 ? (
              <div className="card p-6 text-center text-sm text-[var(--muted)]">No warehouse yet.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {warehouses.map((w) => (
                  <WarehouseCard key={w.id} w={w} onEdit={() => setOpen({ kind: "warehouse", place: w })} onChanged={done} />
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--muted)]">Vans are loaded from the loading warehouse. Turn a warehouse off only when it is empty.</p>
          </section>

          <section className="space-y-3">
            <h2 className="font-heading font-bold text-xl">Vans</h2>
            {vans.length === 0 ? (
              <div className="card p-6 text-center text-sm text-[var(--muted)]">A van shows here after it is loaded for its first trip.</div>
            ) : (
              <ul className="card divide-y divide-[var(--line)] overflow-hidden">
                {vans.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-4 py-3 min-h-[56px]">
                    <span className="icon-tile bg-[var(--accent-tint)] text-[var(--accent-text)]">
                      <Icon name="truck" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold break-words">
                        {v.name} {!v.active && <span className={`chip ${SMALL_CHIP}`}>Off</span>}
                      </p>
                      <p className="text-xs text-[var(--muted)]">{v.vehicle?.number ?? "No vehicle"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-heading font-bold">{v.units.toLocaleString("en-IN")}</p>
                      <p className="text-[11px] text-[var(--muted)]">units · {plural(v.batches, "batch", "batches")}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading font-bold text-xl">{bin?.name ?? "Damaged bin"}</h2>
              <p className="text-sm text-[var(--muted)]">Damaged and expired goods wait here. Write them off, or send them back to the supplier.</p>
            </div>
            {binLots.error && <ErrorBox message={binLots.error} onRetry={binLots.reload} />}
            {bin && !binLots.data && !binLots.error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
            {binLots.data && binLots.data.lots.length === 0 && <div className="card p-6 text-center text-sm text-[var(--muted)]">The damaged bin is empty.</div>}
            {binLots.data && binLots.data.lots.length > 0 && (
              <ul className="card divide-y divide-[var(--line)] overflow-hidden">
                {binLots.data.lots.map((l) => (
                  <li key={l.id} className="px-4 py-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold break-words">{l.product.name}</p>
                        <p className="text-xs text-[var(--muted)] break-words">
                          {l.product.sku} · {l.batch ? `Batch ${l.batch}` : "No batch no."}
                          {l.expiry ? ` · Exp ${ymdText(l.expiry)}` : ""}
                        </p>
                      </div>
                      <p className="shrink-0 font-heading font-bold">{qtyText(l.qty, l.product.unit)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-danger btn-sm !min-h-[40px]" onClick={() => setOpen({ kind: "clear", lot: l, to: "WRITE_OFF" })}>
                        <Icon name="trash" className="h-4 w-4" /> Write off
                      </button>
                      <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" onClick={() => setOpen({ kind: "clear", lot: l, to: "SUPPLIER_RETURN" })}>
                        <Icon name="truck" className="h-4 w-4" /> Return to supplier
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {open?.kind === "warehouse" && <WarehouseSheet place={open.place} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === "transfer" && <TransferSheet warehouses={activeWarehouses} onClose={() => setOpen(null)} onDone={done} />}
      {open?.kind === "clear" && <ClearDamagedSheet lot={open.lot} to={open.to} onClose={() => setOpen(null)} onDone={done} />}
    </div>
  );
}

function WarehouseCard({ w, onEdit, onChanged }: { w: Place; onEdit: () => void; onChanged: (text: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, text: string) {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/stock/locations/${w.id}`, "PATCH", body);
      onChanged(text);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`card p-4 space-y-3 min-w-0 ${w.active ? "" : "opacity-75"}`}>
      <div className="flex items-start gap-3">
        <span className="icon-tile bg-[var(--mor-tint)] text-mor">
          <Icon name="home" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold break-words">{w.name}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {w.isDefault && <span className={`chip chip-mint ${SMALL_CHIP}`}>Loading warehouse</span>}
            {!w.active && <span className={`chip ${SMALL_CHIP}`}>Off</span>}
          </div>
          {w.address && <p className="text-xs text-[var(--muted)] mt-1 break-words">{w.address}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="font-heading font-bold">{w.units.toLocaleString("en-IN")}</p>
          <p className="text-[11px] text-[var(--muted)]">units · {plural(w.batches, "batch", "batches")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" disabled={busy} onClick={onEdit}>
          <Icon name="edit" className="h-4 w-4" /> Edit
        </button>
        {w.active && !w.isDefault && (
          <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" disabled={busy} onClick={() => patch({ isDefault: true }, `${w.name} is now the loading warehouse.`)}>
            Make loading warehouse
          </button>
        )}
        {w.active && !w.isDefault && w.units === 0 && (
          <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" disabled={busy} onClick={() => patch({ active: false }, `${w.name} turned off.`)}>
            Turn off
          </button>
        )}
        {!w.active && (
          <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" disabled={busy} onClick={() => patch({ active: true }, `${w.name} turned on.`)}>
            Turn on
          </button>
        )}
      </div>
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}
