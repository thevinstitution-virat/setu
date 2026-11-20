"use client";

import { useState } from "react";
import { ADJUST_REASONS, type AdjustReason } from "@/lib/inventory-settings";
import { Field, Sheet, errText, readInt, readRupees, send } from "@/components/admin/AdminKit";
import { KIND_LABEL, Segmented, SheetFooter, caseText, qtyText, ymdText, type Lot, type Place, type StockRow } from "@/components/stock/overview/kit";

const PLUS_REASONS: AdjustReason[] = ["count", "found", "opening", "other"];
const MINUS_REASONS: AdjustReason[] = ["count", "lost", "sample", "own_use", "other"];

/** Lot option text: "Batch B12 · Exp 3 Dec 2026 · 40 pc". */
export const lotText = (l: Lot, unit: string) =>
  [l.batch ? `Batch ${l.batch}` : "No batch", l.expiry ? `Exp ${ymdText(l.expiry)}${l.expired ? " (expired)" : ""}` : null, qtyText(l.qty, unit)]
    .filter(Boolean)
    .join(" · ");

/** Add or take stock by hand at one place, with a reason. */
export default function AdjustSheet({
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
  const usable = places.filter((p) => p.active);
  const [placeId, setPlaceId] = useState(() => (usable.find((p) => p.kind === "WAREHOUSE" && p.isDefault) ?? usable[0])?.id ?? "");
  const [dir, setDir] = useState<"plus" | "minus">("plus");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<AdjustReason | "">("");
  const [note, setNote] = useState("");
  const [lotId, setLotId] = useState("");
  const [batch, setBatch] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cost, setCost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const here = lots.filter((l) => l.location.id === placeId);
  const held = here.reduce((a, l) => a + l.qty, 0);
  const reasons = dir === "plus" ? PLUS_REASONS : MINUS_REASONS;
  const n = readInt(qty, 1);
  const cases = typeof n === "number" ? caseText(n, product) : null;

  function changeDir(d: "plus" | "minus") {
    setDir(d);
    setLotId("");
    if (reason && !(d === "plus" ? PLUS_REASONS : MINUS_REASONS).includes(reason)) setReason("");
    setError(null);
  }

  async function save() {
    if (!placeId) return setError("Pick a place");
    if (n === null || n === "bad") return setError("Enter a whole number above 0");
    if (!reason) return setError("Pick a reason");
    if (reason === "other" && !note.trim()) return setError("Write what happened");
    const body: Record<string, unknown> = { locationId: placeId, productId: product.id, delta: dir === "plus" ? n : -n, reason, note: note.trim() || null };
    if (lotId) body.lotId = lotId;
    else if (dir === "plus") {
      if (batch.trim()) body.batch = batch.trim();
      if (expiry) body.expiry = expiry;
      const c = readRupees(cost);
      if (c === "bad") return setError("Cost must be an amount in rupees");
      if (c !== null) body.unitCost = c;
    }
    setBusy(true);
    setError(null);
    try {
      await send("/api/stock/adjust", "POST", body);
      const place = usable.find((p) => p.id === placeId)?.name ?? "";
      onDone(`${dir === "plus" ? "Added" : "Took"} ${qtyText(n, product.unit)} ${dir === "plus" ? "to" : "from"} ${place}.`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet title={`Adjust stock · ${product.name}`} onClose={onClose} footer={<SheetFooter error={error} busy={busy} onCancel={onClose} onSave={save} label="Save change" />}>
      <Field label="Place" hint={placeId ? `${qtyText(held, product.unit)} here now` : undefined}>
        <select
          className="input"
          value={placeId}
          onChange={(e) => {
            setPlaceId(e.target.value);
            setLotId("");
            setError(null);
          }}
        >
          {usable.length === 0 && <option value="">No places yet</option>}
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({KIND_LABEL[p.kind]})
            </option>
          ))}
        </select>
      </Field>

      <Segmented
        label="Add or take away"
        value={dir}
        onChange={changeDir}
        options={[
          ["plus", "+ Add stock"],
          ["minus", "− Take away"],
        ]}
      />

      <Field label={`Quantity (${product.unit})`} hint={cases ? `= ${cases}` : undefined}>
        <input className="input" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} placeholder="0" />
      </Field>

      <Field label="Reason">
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
          <option value="">Pick a reason</option>
          {reasons.map((r) => (
            <option key={r} value={r}>
              {ADJUST_REASONS[r]}
            </option>
          ))}
        </select>
      </Field>

      <Field label={reason === "other" ? "Note (needed)" : "Note (optional)"}>
        <input className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened?" />
      </Field>

      {dir === "plus" ? (
        <section className="card p-4 space-y-3">
          <p className="font-heading font-bold">Batch</p>
          <Field label="Add to">
            <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
              <option value="">A new batch</option>
              {here.map((l) => (
                <option key={l.id} value={l.id}>
                  {lotText(l, product.unit)}
                </option>
              ))}
            </select>
          </Field>
          {!lotId && (
            <div className="grid gap-3 grid-cols-2">
              <Field label="Batch no. (optional)">
                <input className="input" maxLength={40} value={batch} onChange={(e) => setBatch(e.target.value)} />
              </Field>
              <Field label={product.trackExpiry ? "Expiry date" : "Expiry (optional)"}>
                <input className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </Field>
              <Field label="Cost per unit ₹ (optional)" hint="Blank uses the last cost." className="col-span-2 sm:col-span-1">
                <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
              </Field>
            </div>
          )}
        </section>
      ) : (
        <Field label="Take from" hint="First expiry first takes the oldest dates first.">
          <select className="input" value={lotId} onChange={(e) => setLotId(e.target.value)}>
            <option value="">First expiry first</option>
            {here.map((l) => (
              <option key={l.id} value={l.id}>
                {lotText(l, product.unit)}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Sheet>
  );
}
