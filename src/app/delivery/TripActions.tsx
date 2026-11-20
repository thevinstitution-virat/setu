"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

/** Big "Start trip" with a second tap to confirm (orders go out for delivery and may be invoiced). */
export function StartTripButton({ tripId, stops }: { tripId: string; stops: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/start`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not start the trip");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {confirm ? (
        <div className="rounded-2xl bg-[var(--kesar-tint)] p-3 space-y-3">
          <p className="text-sm font-semibold text-[var(--kesar-text)]">
            Goods for all {stops} stop{stops === 1 ? "" : "s"} loaded in the van?
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-outline" onClick={() => setConfirm(false)} disabled={busy}>
              Not yet
            </button>
            <button type="button" className="btn btn-kesar" onClick={start} disabled={busy}>
              {busy ? "Starting…" : "Yes, start"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-kesar w-full !min-h-[56px] text-base" onClick={() => setConfirm(true)}>
          <Icon name="truck" /> Start trip
        </button>
      )}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
    </div>
  );
}

/** Re-order the open stops: nearest next from the last done stop (or the warehouse). */
export function SortStopsButton({ tripId, className = "" }: { tripId: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function sort() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/sequence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not sort the stops");
      const total = Number(d.total ?? 0);
      const noPin = total - Number(d.located ?? 0);
      setNote({
        ok: true,
        text:
          total === 0
            ? "No open stops to sort."
            : `Sorted ${total} stop${total === 1 ? "" : "s"}.${noPin > 0 ? ` ${noPin} without a map pin go last, by area.` : ""}`,
      });
      router.refresh();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button type="button" className="btn btn-quiet w-full" onClick={sort} disabled={busy}>
        <Icon name="route" className="h-4 w-4" /> {busy ? "Sorting…" : "Sort by distance"}
      </button>
      {note && <p className={`text-xs mt-1.5 ${note.ok ? "text-[var(--muted)]" : "text-[#a8281e]"}`}>{note.text}</p>}
    </div>
  );
}
