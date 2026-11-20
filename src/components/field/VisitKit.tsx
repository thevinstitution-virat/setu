"use client";

import { useState } from "react";
import { Field, Sheet, errText, send } from "@/components/admin/AdminKit";
import { getLocation } from "@/lib/geo";
import { NO_ORDER_REASONS, type NoOrderReason } from "@/lib/field-settings";
import { fieldChanged, type Visit } from "./kit";

/** Check in at a shop with the phone's location. Throws ApiError (409 "Check out of X first"). */
export async function startVisit(retailerId: string): Promise<Visit> {
  const loc = await getLocation();
  const { result } = await send<{ result: Visit }>("/api/visits", "POST", { retailerId, ...loc });
  fieldChanged();
  return result;
}

/** Check out of a visit. A reason is needed when no order was placed on it. */
export async function endVisit(visitId: string, body: { reason?: NoOrderReason; note?: string } = {}) {
  const loc = await getLocation();
  await send(`/api/visits/${visitId}/checkout`, "PATCH", { ...body, lat: loc.lat, lng: loc.lng });
  fieldChanged();
}

export const reasonLabel = (key: string | null | undefined) =>
  key ? (NO_ORDER_REASONS[key as NoOrderReason] ?? key) : "";

/** "No order": pick why, add a note (needed for Other), and check out. */
export function NoOrderSheet({
  visitId,
  shopName,
  onClose,
  onDone,
}: {
  visitId: string;
  shopName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState<NoOrderReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!reason) return setError("Pick why there was no order");
    if (reason === "other" && !note.trim()) return setError("Add a note for Other");
    setBusy(true);
    try {
      await endVisit(visitId, { reason, note: note.trim() || undefined });
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`No order at ${shopName}`}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet flex-1 min-h-[44px]" onClick={onClose} disabled={busy}>
              Back
            </button>
            <button type="button" className="btn btn-kesar flex-[2] min-h-[44px]" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Check out"}
            </button>
          </div>
        </div>
      }
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-[var(--ink-2)] mb-1">Why no order?</legend>
        {(Object.keys(NO_ORDER_REASONS) as NoOrderReason[]).map((k) => (
          <label
            key={k}
            className={`flex items-center gap-3 rounded-xl border px-3 min-h-[48px] cursor-pointer ${
              reason === k ? "border-[var(--mor)] bg-[var(--mint-tint)]" : "border-[var(--line)] bg-white"
            }`}
          >
            <input
              type="radio"
              name="no-order-reason"
              value={k}
              checked={reason === k}
              onChange={() => {
                setReason(k);
                setError(null);
              }}
              className="h-4 w-4 accent-[var(--mor)]"
            />
            <span className="text-sm font-medium">{NO_ORDER_REASONS[k]}</span>
          </label>
        ))}
      </fieldset>
      <Field label={reason === "other" ? "Note" : "Note (optional)"}>
        <textarea className="input min-h-[80px]" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Sheet>
  );
}
