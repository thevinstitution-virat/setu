"use client";

import { useState } from "react";
import { DAMAGE_REASONS, type DamageReason } from "@/lib/inventory-settings";
import { Field, Sheet, errText, readInt, send } from "@/components/admin/AdminKit";
import { lotText } from "@/components/stock/overview/AdjustSheet";
import { KIND_LABEL, SheetFooter, caseText, qtyText, type Lot, type Place, type StockRow } from "@/components/stock/overview/kit";

/** Move goods from a warehouse or van into the damaged bin. */
export default function DamageSheet({
  product,
  lots,
  places,
  onClose,
  onDone,
}: {
  product: StockRow;
  lots: Lot[];
  places: Place[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const usable = places.filter((p) => p.active && (p.kind === "WAREHOUSE" || p.kind === "VAN"));
  const held = (id: string) => lots.filter((l) => l.location.id === id).reduce((a, l) => a + l.qty, 0);
  const [placeId, setPlaceId] = useState(
    () => (usable.find((p) => held(p.id) > 0 && p.isDefault) ?? usable.find((p) => held(p.id) > 0) ?? usable[0])?.id ?? ""
  );
  const [lotId, setLotId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<DamageReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const here = lots.filter((l) => l.location.id === placeId);
  const lot = here.find((l) => l.id === lotId) ?? null;
  const max = lot ? lot.qty : held(placeId);
  const n = readInt(qty, 1);
  const cases = typeof n === "number" ? caseText(n, product) : null;

  async function save() {
    if (!placeId) return setError("Pick a place");
    if (n === null || n === "bad") return setError("Enter a whole number above 0");
    if (n > max) return setError(`Only ${qtyText(max, product.unit)} ${lot ? "in this batch" : "here"}`);
    if (!reason) return setError("Pick a reason");
    setBusy(true);
    setError(null);
    try {
      await send("/api/stock/damage", "POST", { locationId: placeId, productId: product.id, qty: n, reason, lotId: lotId || null, note: note.trim() || null });
      onDone(`${qtyText(n, product.unit)} moved to the damaged bin.`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Move to damaged · ${product.name}`}
      onClose={onClose}
      footer={<SheetFooter error={error} busy={busy} onCancel={onClose} onSave={save} label="Move to damaged" busyLabel="Moving…" />}
    >
      <p className="text-sm text-[var(--muted)]">Goods in the damaged bin can&apos;t be sold. Write them off or send them back to the supplier from Places.</p>

      <Field label="From">
        <select
          className="input"
          value={placeId}
          onChange={(e) => {
            setPlaceId(e.target.value);
            setLotId("");
            setError(null);
          }}
        >
          {usable.length === 0 && <option value="">No warehouse yet</option>}
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({KIND_LABEL[p.kind]}) · {qtyText(held(p.id), product.unit)}
            </option>
          ))}
        </select>
      </Field>

      {here.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">No stock of this product here.</p>
      ) : (
        <Field label="Batch">
          <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">Any (first expiry first)</option>
            {here.map((l) => (
              <option key={l.id} value={l.id}>
                {lotText(l, product.unit)}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label={`Quantity (${product.unit})`} hint={cases ? `= ${cases}` : max > 0 ? `Up to ${qtyText(max, product.unit)}` : undefined}>
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} placeholder="0" />
          {max > 0 && (
            <button type="button" className="btn btn-quiet shrink-0" onClick={() => setQty(String(max))}>
              All {max}
            </button>
          )}
        </div>
      </Field>

      <Field label="Reason">
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value as DamageReason)}>
          <option value="">Pick a reason</option>
          {(Object.keys(DAMAGE_REASONS) as DamageReason[]).map((r) => (
            <option key={r} value={r}>
              {DAMAGE_REASONS[r]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note (optional)">
        <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Torn cartons from the last delivery" />
      </Field>
    </Sheet>
  );
}
