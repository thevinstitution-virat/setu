"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ActiveChip, ErrorBox, Field, errText, readInt, send, useFetch } from "@/components/admin/AdminKit";

type Vehicle = { id: string; number: string; name: string | null; capacityKg: number | null; active: boolean };

const plate = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);

export default function VehiclesPage() {
  const { data, error, reload } = useFetch<{ vehicles: Vehicle[] }>("/api/vehicles");
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-5 max-w-2xl">
      <Link href="/admin/dispatch" className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
        <Icon name="back" className="h-4 w-4" /> Dispatch
      </Link>
      <div>
        <p className="page-kick">Delivery</p>
        <h1 className="page-title">Vehicles</h1>
        <p className="page-sub">Vans and bikes you send out on trips. Turn one off when it is sold or off the road; old trips keep it.</p>
      </div>

      <VehicleForm key="new" title="Add a vehicle" onSaved={reload} />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && data.vehicles.length === 0 && <div className="card p-6 text-center text-sm text-[var(--muted)]">No vehicles yet. Add your first one above.</div>}
      {data && data.vehicles.length > 0 && (
        <ul className="card divide-y divide-[var(--line)] overflow-hidden">
          {data.vehicles.map((v) => (
            <li key={v.id} className="p-4">
              {editing === v.id ? (
                <VehicleForm
                  vehicle={v}
                  title={`Edit ${v.number}`}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    reload();
                  }}
                  bare
                />
              ) : (
                <VehicleRow v={v} onEdit={() => setEditing(v.id)} onChanged={reload} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VehicleRow({ v, onEdit, onChanged }: { v: Vehicle; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/vehicles/${v.id}`, "PATCH", { active: !v.active });
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`icon-tile ${v.active ? "bg-[var(--kesar-tint)] text-[var(--kesar-text)]" : "bg-ink/5 text-[var(--muted)]"}`}>
          <Icon name="truck" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading font-bold break-all">{v.number}</p>
          <p className="text-xs text-[var(--muted)]">{[v.name, v.capacityKg ? `${v.capacityKg} kg` : null].filter(Boolean).join(" · ") || "No name"}</p>
        </div>
        <ActiveChip active={v.active} on="In use" off="Off" />
        <div className="flex gap-2 w-full sm:w-auto">
          <button type="button" className="btn btn-quiet btn-sm flex-1 sm:flex-none" onClick={onEdit} disabled={busy}>
            <Icon name="edit" className="h-4 w-4" /> Edit
          </button>
          <button type="button" className="btn btn-quiet btn-sm flex-1 sm:flex-none" onClick={toggle} disabled={busy}>
            {v.active ? "Turn off" : "Turn on"}
          </button>
        </div>
      </div>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
    </div>
  );
}

function VehicleForm({
  vehicle,
  title,
  onSaved,
  onCancel,
  bare,
}: {
  vehicle?: Vehicle;
  title: string;
  onSaved: () => void;
  onCancel?: () => void;
  bare?: boolean;
}) {
  const [number, setNumber] = useState(vehicle?.number ?? "");
  const [name, setName] = useState(vehicle?.name ?? "");
  const [cap, setCap] = useState(vehicle?.capacityKg ? String(vehicle.capacityKg) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (number.length < 4) return setError("Enter the vehicle number, like MH12AB1234");
    const kg = readInt(cap, 1);
    if (kg === "bad") return setError("Capacity must be a whole number of kg");
    setBusy(true);
    setError(null);
    try {
      const body = { number, name: name.trim() || null, capacityKg: kg };
      if (vehicle) await send(`/api/vehicles/${vehicle.id}`, "PATCH", body);
      else await send("/api/vehicles", "POST", body);
      if (!vehicle) {
        setNumber("");
        setName("");
        setCap("");
      }
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className={bare ? "space-y-3" : "card p-4 sm:p-5 space-y-3"}>
      <p className="font-heading font-bold">{title}</p>
      <div className="grid gap-3 sm:grid-cols-[1.2fr_1.2fr_0.8fr]">
        <Field label="Number">
          <input
            className="input uppercase"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="MH12AB1234"
            value={number}
            onChange={(e) => setNumber(plate(e.target.value))}
          />
        </Field>
        <Field label="Name (optional)">
          <input className="input" maxLength={40} placeholder="e.g. Small van" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Capacity (kg)">
          <input className="input" inputMode="numeric" placeholder="Optional" value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <div className="flex gap-2 justify-end">
        {onCancel && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy}>
          {busy ? "Saving…" : vehicle ? "Save" : (
            <>
              <Icon name="plus" className="h-4 w-4" /> Add vehicle
            </>
          )}
        </button>
      </div>
    </form>
  );
}
