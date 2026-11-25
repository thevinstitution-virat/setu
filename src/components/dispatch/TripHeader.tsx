"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { Field, Sheet, errText, send, useFetch } from "@/components/admin/AdminKit";
import { StatusChip, dayLabel, timeLabel, vehicleText, type Board, type TripDetail } from "@/components/dispatch/kit";

/** Trip header (printed with the load sheet) and the edit sheet for driver, vehicle, slot and note. */
export default function TripHeader({ data, onDone }: { data: TripDetail; onDone: (msg?: string) => void }) {
  const { trip, canManage } = data;
  const [editing, setEditing] = useState(false);

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="page-kick">Trip</p>
          <h1 className="page-title break-all">{trip.number}</h1>
          <p className="text-sm text-[var(--ink-2)] mt-1">
            {dayLabel(trip.date)} · {trip.slotLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip status={trip.status} />
          {canManage && trip.status !== "CLOSED" && (
            <button type="button" className="btn btn-quiet btn-sm print:hidden" onClick={() => setEditing(true)}>
              <Icon name="edit" className="h-4 w-4" /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="icon-tile bg-[var(--success-tint)] text-[var(--success-text)] print:hidden">
            <Icon name="user" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted)]">Driver</p>
            <p className="text-sm font-semibold truncate">{trip.driver.name}</p>
            {trip.driver.phone && (
              <a href={`tel:${trip.driver.phone}`} className="text-sm font-semibold text-[var(--accent-text)]">
                {trip.driver.phone}
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 min-w-0">
          <span className="icon-tile bg-[var(--accent-tint)] text-[var(--accent-text)] print:hidden">
            <Icon name="truck" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-[var(--muted)]">Vehicle</p>
            <p className="text-sm font-semibold truncate">{vehicleText(trip.vehicle)}</p>
          </div>
        </div>
      </div>

      {(trip.startedAt || trip.closedAt) && (
        <p className="mt-3 text-xs text-[var(--muted)]">
          {trip.startedAt && `Left ${timeLabel(trip.startedAt)}`}
          {trip.closedAt && ` · Closed ${timeLabel(trip.closedAt)}`}
        </p>
      )}
      {trip.note && <p className="mt-3 rounded-xl bg-ink/5 px-3 py-2 text-sm text-[var(--ink-2)]">{trip.note}</p>}

      {editing && (
        <EditSheet
          data={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onDone("Trip updated.");
          }}
        />
      )}
    </div>
  );
}

function EditSheet({ data, onClose, onSaved }: { data: TripDetail; onClose: () => void; onSaved: () => void }) {
  const { trip } = data;
  const planned = trip.status === "PLANNED";
  const lists = useFetch<Board>(`/api/trips?date=${trip.date}`);
  const [driverId, setDriverId] = useState(trip.driver.id);
  const [vehicleId, setVehicleId] = useState(trip.vehicle?.id ?? "");
  const [slot, setSlot] = useState(trip.slot);
  const [note, setNote] = useState(trip.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const drivers = lists.data?.drivers ?? [];
  const vehicles = lists.data?.vehicles ?? [];
  const slots = lists.data?.slots ?? [];

  async function save() {
    const body: Record<string, string | null> = {};
    if (planned && driverId !== trip.driver.id) body.driverId = driverId;
    if (planned && slot !== trip.slot) body.slot = slot;
    if (vehicleId !== (trip.vehicle?.id ?? "")) body.vehicleId = vehicleId || null;
    if (note.trim() !== (trip.note ?? "")) body.note = note.trim() || null;
    if (!Object.keys(body).length) return onClose();
    setBusy(true);
    setError(null);
    try {
      await send(`/api/trips/${trip.id}`, "PATCH", body);
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <Sheet
      title={`Edit ${trip.number}`}
      onClose={onClose}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-quiet" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-kesar" onClick={save} disabled={busy || !lists.data}>
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      }
    >
      {lists.error && <p className="text-sm text-[var(--risk-text)]">{lists.error}</p>}
      {!lists.data && !lists.error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {lists.data && (
        <>
          <Field label="Driver" hint={planned ? undefined : "The trip has left: the driver can't change now."}>
            <select className="input" value={driverId} disabled={!planned} onChange={(e) => setDriverId(e.target.value)}>
              {!drivers.some((d) => d.id === trip.driver.id) && <option value={trip.driver.id}>{trip.driver.name}</option>}
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.phone ? ` · ${d.phone}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Slot" hint={planned ? undefined : "The trip has left: the slot can't change now."}>
            <select className="input" value={slot} disabled={!planned} onChange={(e) => setSlot(e.target.value)}>
              {!slots.some((s) => s.key === trip.slot) && <option value={trip.slot}>{trip.slotLabel}</option>}
              {slots.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vehicle">
            <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">No vehicle</option>
              {trip.vehicle && !vehicles.some((v) => v.id === trip.vehicle!.id) && <option value={trip.vehicle.id}>{vehicleText(trip.vehicle)}</option>}
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {vehicleText(v)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Note for the driver">
            <textarea className="input min-h-[80px]" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      )}
    </Sheet>
  );
}
