"use client";

import { useState } from "react";
import { Field, Sheet, errText, readInt, send, useFetch } from "@/components/admin/AdminKit";
import { lotText } from "@/components/stock/overview/AdjustSheet";
import { SheetFooter, qtyText, ymdText, type Lot, type Place } from "@/components/stock/overview/kit";

/** Add a warehouse, or rename / re-address one. */
export function WarehouseSheet({ place, onClose, onDone }: { place: Place | null; onClose: () => void; onDone: (text: string) => void }) {
  const [name, setName] = useState(place?.name ?? "");
  const [address, setAddress] = useState(place?.address ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (name.trim().length < 2) return setError("Enter the warehouse name");
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), address: address.trim() || null };
      if (place) await send(`/api/stock/locations/${place.id}`, "PATCH", body);
      else await send("/api/stock/locations", "POST", body);
      onDone(place ? `Saved ${name.trim()}.` : `Added ${name.trim()}.`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={place ? `Edit ${place.name}` : "Add warehouse"}
      onClose={onClose}
      footer={<SheetFooter error={error} busy={busy} onCancel={onClose} onSave={save} label={place ? "Save" : "Add warehouse"} />}
    >
      <Field label="Name">
        <input className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main godown" />
      </Field>
      <Field label="Address (optional)">
        <textarea className="input min-h-20" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/** Write off, or send back to a supplier, a batch from the damaged bin. */
export function ClearDamagedSheet({
  lot,
  to,
  onClose,
  onDone,
}: {
  lot: Lot;
  to: "WRITE_OFF" | "SUPPLIER_RETURN";
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const ret = to === "SUPPLIER_RETURN";
  const suppliers = useFetch<{ suppliers: { id: string; name: string; active: boolean }[] }>(ret ? "/api/suppliers" : null);
  const [qty, setQty] = useState(String(lot.qty));
  const [supplierId, setSupplierId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unit = lot.product.unit;

  async function save() {
    const n = readInt(qty, 1);
    if (n === null || n === "bad") return setError("Enter a whole number above 0");
    if (n > lot.qty) return setError(`Only ${qtyText(lot.qty, unit)} in this batch`);
    if (ret && !supplierId) return setError("Pick the supplier");
    setBusy(true);
    setError(null);
    try {
      await send("/api/stock/damaged", "POST", { productId: lot.product.id, qty: n, lotId: lot.id, to, supplierId: ret ? supplierId : null, note: note.trim() || null });
      const who = ret ? suppliers.data?.suppliers.find((s) => s.id === supplierId)?.name : null;
      onDone(ret ? `${qtyText(n, unit)} of ${lot.product.name} sent back${who ? ` to ${who}` : ""}.` : `${qtyText(n, unit)} of ${lot.product.name} written off.`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  const list = (suppliers.data?.suppliers ?? []).filter((s) => s.active);

  return (
    <Sheet
      title={ret ? "Return to supplier" : "Write off"}
      onClose={onClose}
      footer={
        <SheetFooter
          error={error}
          busy={busy}
          onCancel={onClose}
          onSave={save}
          label={ret ? "Send back" : "Write off"}
          busyLabel={ret ? "Saving…" : "Writing off…"}
          danger={!ret}
        />
      }
    >
      <div className="card p-4">
        <p className="text-sm font-bold break-words">{lot.product.name}</p>
        <p className="text-xs text-[var(--muted)] break-words">
          {lot.batch ? `Batch ${lot.batch}` : "No batch no."}
          {lot.expiry ? ` · Exp ${ymdText(lot.expiry)}` : ""} · {qtyText(lot.qty, unit)} in the damaged bin
        </p>
      </div>
      {!ret && <p className="text-sm text-[var(--muted)]">Written-off goods leave your stock for good. This can&apos;t be undone.</p>}

      <Field label={`Quantity (${unit})`}>
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
          <button type="button" className="btn btn-quiet shrink-0" onClick={() => setQty(String(lot.qty))}>
            All {lot.qty}
          </button>
        </div>
      </Field>

      {ret && (
        <Field label="Supplier">
          {suppliers.error ? (
            <p className="text-sm text-[var(--risk-text)]">{suppliers.error}</p>
          ) : !suppliers.data ? (
            <p className="text-sm text-[var(--muted)]">Loading…</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No suppliers yet. Add one under Suppliers.</p>
          ) : (
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Pick the supplier</option>
              {list.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      <Field label="Note (optional)">
        <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder={ret ? "e.g. Debit note 112" : "e.g. Crushed in transit"} />
      </Field>
    </Sheet>
  );
}

/** Move stock from one warehouse to another (keeps batch and expiry). */
export function TransferSheet({ warehouses, onClose, onDone }: { warehouses: Place[]; onClose: () => void; onDone: (text: string) => void }) {
  const [fromId, setFromId] = useState(() => (warehouses.find((w) => w.isDefault) ?? warehouses[0])?.id ?? "");
  const [toId, setToId] = useState(() => warehouses.find((w) => w.id !== fromId)?.id ?? "");
  const [productId, setProductId] = useState("");
  const [lotId, setLotId] = useState("");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lots = useFetch<{ lots: Lot[] }>(fromId ? `/api/stock/lots?locationId=${fromId}` : null);

  const here = (lots.data?.lots ?? []).filter((l) => l.location.id === fromId);
  const products = [...new Map(here.map((l) => [l.product.id, l.product])).values()]
    .map((p) => ({ ...p, qty: here.filter((l) => l.product.id === p.id).reduce((a, l) => a + l.qty, 0) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const product = products.find((p) => p.id === productId) ?? null;
  const batches = here.filter((l) => l.product.id === productId);
  const lot = batches.find((l) => l.id === lotId) ?? null;
  const max = lot ? lot.qty : (product?.qty ?? 0);

  function changeFrom(id: string) {
    setFromId(id);
    if (toId === id) setToId(warehouses.find((w) => w.id !== id)?.id ?? "");
    setProductId("");
    setLotId("");
    setError(null);
  }

  async function save() {
    if (!fromId || !toId) return setError("Pick both warehouses");
    if (fromId === toId) return setError("Pick two different warehouses");
    if (!product) return setError("Pick a product");
    const n = readInt(qty, 1);
    if (n === null || n === "bad") return setError("Enter a whole number above 0");
    if (n > max) return setError(`Only ${qtyText(max, product.unit)} ${lot ? "in this batch" : "here"}`);
    setBusy(true);
    setError(null);
    try {
      await send("/api/stock/transfer", "POST", { fromId, toId, productId: product.id, qty: n, lotId: lotId || null, note: note.trim() || null });
      const toName = warehouses.find((w) => w.id === toId)?.name ?? "";
      onDone(`${qtyText(n, product.unit)} of ${product.name} moved to ${toName}.`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Transfer between warehouses" onClose={onClose} footer={<SheetFooter error={error} busy={busy} onCancel={onClose} onSave={save} label="Move stock" busyLabel="Moving…" />}>
      <div className="grid gap-3 grid-cols-2">
        <Field label="From">
          <select className="input" value={fromId} onChange={(e) => changeFrom(e.target.value)}>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
            {warehouses
              .filter((w) => w.id !== fromId)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </Field>
      </div>

      {lots.error && <p className="text-sm text-[var(--risk-text)]">{lots.error}</p>}
      {!lots.data && !lots.error && <p className="text-sm text-[var(--muted)]">Loading stock…</p>}
      {lots.data && products.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing in stock at this warehouse.</p>}

      {products.length > 0 && (
        <>
          <Field label="Product">
            <select
              className="input"
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setLotId("");
                setError(null);
              }}
            >
              <option value="">Pick a product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {qtyText(p.qty, p.unit)}
                </option>
              ))}
            </select>
          </Field>
          {product && (
            <>
              <Field label="Batch">
                <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  <option value="">Any (first expiry first)</option>
                  {batches.map((l) => (
                    <option key={l.id} value={l.id}>
                      {lotText(l, product.unit)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Quantity (${product.unit})`} hint={`Up to ${qtyText(max, product.unit)}`}>
                <div className="flex gap-2">
                  <input className="input min-w-0 flex-1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} placeholder="0" />
                  <button type="button" className="btn btn-quiet shrink-0" onClick={() => setQty(String(max))}>
                    All {max}
                  </button>
                </div>
              </Field>
            </>
          )}
          <Field label="Note (optional)">
            <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}
    </Sheet>
  );
}
