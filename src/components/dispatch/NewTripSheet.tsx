"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { Field, Sheet, errText, send } from "@/components/admin/AdminKit";
import { dayLabel, plural, type Board } from "@/components/dispatch/kit";

/** New trip for the board's day: slot, driver, vehicle (optional), note, and the selected ready orders. */
export default function NewTripSheet({
  board,
  selectedIds,
  onClose,
  onMade,
}: {
  board: Board;
  selectedIds: string[];
  onClose: () => void;
  onMade: (trip: { id: string; number: string }, withOrders: boolean) => void;
}) {
  const [slot, setSlot] = useState(board.slots[0]?.key ?? "");
  const [driverId, setDriverId] = useState(board.drivers.length === 1 ? board.drivers[0].id : "");
  const [vehicleId, setVehicleId] = useState("");
  const [note, setNote] = useState("");
  const [take, setTake] = useState(selectedIds.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = board.ready.filter((o) => selectedIds.includes(o.id));
  const value = chosen.reduce((s, o) => s + o.total, 0);

  async function save() {
    if (!slot) return setError("Pick a slot");
    if (!driverId) return setError("Pick a driver");
    setBusy(true);
    setError(null);
    try {
      const d = await send<{ trip: { id: string; number: string } }>("/api/trips", "POST", {
        date: board.date,
        slot,
        driverId,
        vehicleId: vehicleId || null,
        note: note.trim() || null,
        orderIds: take ? selectedIds : [],
      });
      onMade(d.trip, take && selectedIds.length > 0);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="New trip"
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[#a8281e]">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar" onClick={save} disabled={busy || board.drivers.length === 0}>
              {busy ? "Making…" : "Make trip"}
            </button>
          </div>
        </div>
      }
    >
      <p className="text-sm text-[var(--ink-2)]">
        For <b>{dayLabel(board.date)}</b>
      </p>

      <div>
        <span className="block text-sm font-medium text-[var(--ink-2)] mb-1.5">Slot</span>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Slot">
          {board.slots.map((s) => (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={slot === s.key}
              onClick={() => setSlot(s.key)}
              className={`min-h-[44px] rounded-xl px-4 text-sm font-bold transition ${
                slot === s.key ? "bg-gradient-to-br from-mor to-[#0c3634] text-white" : "bg-ink/5 text-[var(--ink-2)]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <Field label="Driver">
        {board.drivers.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">
            No delivery staff yet.{" "}
            <Link href="/admin/team" className="font-bold text-[var(--kesar-text)]">
              Add one in Team
            </Link>
          </p>
        ) : (
          <select className="input" value={driverId} onChange={(e) => setDriverId(e.target.value)}>
            <option value="">Pick a driver</option>
            {board.drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.phone ? ` · ${d.phone}` : ""}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        label="Vehicle (optional)"
        hint={
          <>
            Add vehicles under{" "}
            <Link href="/admin/dispatch/vehicles" className="font-semibold underline">
              Vehicles
            </Link>
            .
          </>
        }
      >
        <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">No vehicle</option>
          {board.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.number}
              {v.name ? ` · ${v.name}` : ""}
              {v.capacityKg ? ` · ${v.capacityKg} kg` : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note for the driver (optional)">
        <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Collect empties at the godown first" />
      </Field>

      {selectedIds.length > 0 && (
        <label className="flex items-start gap-3 rounded-2xl border border-[var(--line)] bg-white p-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mor)]" checked={take} onChange={(e) => setTake(e.target.checked)} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">
              Put the {plural(selectedIds.length, "selected order")} on this trip
            </span>
            <span className="block text-xs text-[var(--muted)]">{formatINR(value)} in all</span>
          </span>
        </label>
      )}
      {selectedIds.length === 0 && (
        <p className="text-xs text-[var(--muted)] flex items-start gap-1.5">
          <Icon name="box" className="h-4 w-4 shrink-0" /> Tick orders under Ready to go first to put them on the new trip, or add them later.
        </p>
      )}
    </Sheet>
  );
}
