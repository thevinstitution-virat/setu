"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { errText, readRupees, rupeeText, send } from "@/components/admin/AdminKit";

/** Delivery cost used by the route report: per trip and per drop (settings.reports). */
export default function CostForm({ tripCost, dropCost, canEdit }: { tripCost: number; dropCost: number; canEdit: boolean }) {
  const router = useRouter();
  const [trip, setTrip] = useState(rupeeText(tripCost));
  const [drop, setDrop] = useState(rupeeText(dropCost));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const t = readRupees(trip || "0");
    const d = readRupees(drop || "0");
    if (t === "bad" || d === "bad") return setNote("Write the costs in rupees");
    setBusy(true);
    setNote(null);
    try {
      await send("/api/admin/settings", "PATCH", { reports: { tripCost: t ?? 0, dropCost: d ?? 0 } });
      setNote("Saved");
      router.refresh();
    } catch (err) {
      setNote(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-[var(--muted)]">
        Cost of one trip (₹)
        <input className="input !py-1.5 mt-1 block w-32" inputMode="decimal" value={trip} disabled={!canEdit || busy} onChange={(e) => setTrip(e.target.value)} placeholder="0" />
      </label>
      <label className="text-xs text-[var(--muted)]">
        Cost per drop (₹)
        <input className="input !py-1.5 mt-1 block w-32" inputMode="decimal" value={drop} disabled={!canEdit || busy} onChange={(e) => setDrop(e.target.value)} placeholder="0" />
      </label>
      {canEdit && (
        <button className="btn btn-mor btn-sm" disabled={busy}>
          Save
        </button>
      )}
      {note && <span className="text-xs text-[var(--muted)]">{note}</span>}
      <p className="text-xs text-[var(--muted)] w-full">Trip cost (driver, fuel, van) is shared by the drops on that trip. Leave 0 to see margin before delivery cost.</p>
    </form>
  );
}
