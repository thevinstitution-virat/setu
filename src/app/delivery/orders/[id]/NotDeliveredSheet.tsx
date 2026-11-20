"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getLocation } from "@/lib/geo";
import { FAIL_REASONS, type FailReason } from "@/lib/delivery-settings";
import { Sheet } from "@/components/store/shared";

/** "Couldn't deliver": pick why, add a note (needed for Other), back to the stop list. */
export default function NotDeliveredSheet({ orderId, open, onCloseAction }: { orderId: string; open: boolean; onCloseAction: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState<FailReason | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!reason) return setError("Pick what happened");
    if (reason === "other" && !note.trim()) return setError("Write what happened");
    setBusy(true);
    try {
      const loc = await getLocation();
      const res = await fetch(`/api/orders/${orderId}/not-delivered`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note: note.trim() || undefined, lat: loc.lat, lng: loc.lng }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save");
      router.push("/delivery");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      title="Couldn't deliver"
      onCloseAction={onCloseAction}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
          <button type="button" className="btn btn-danger w-full !min-h-[52px]" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Mark not delivered"}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2" role="radiogroup" aria-label="What happened">
          {(Object.entries(FAIL_REASONS) as [FailReason, string][]).map(([k, label]) => (
            <label
              key={k}
              className={`flex items-center gap-3 rounded-xl px-3 min-h-[48px] cursor-pointer border ${
                reason === k ? "border-[var(--ink)] bg-white" : "border-transparent bg-black/[0.04]"
              }`}
            >
              <input
                type="radio"
                name="fail-reason"
                value={k}
                checked={reason === k}
                onChange={() => setReason(k)}
                className="h-5 w-5 accent-[var(--mor)]"
              />
              <span className="text-sm font-semibold">{label}</span>
            </label>
          ))}
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-[var(--ink-2)]">
            Note {reason === "other" ? "(needed)" : "(optional)"}
          </span>
          <textarea
            className="input mt-1"
            rows={2}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Shop opens at 4 pm"
          />
        </label>
        <p className="text-xs text-[var(--muted)]">The order goes back to the office for another trip.</p>
      </div>
    </Sheet>
  );
}
