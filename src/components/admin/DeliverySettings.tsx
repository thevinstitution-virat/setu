"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { toPaise } from "@/lib/money";
import { getLocation } from "@/lib/geo";
import type { DeliverySettings as Delivery } from "@/lib/delivery-settings";
import { Field, Toggle } from "@/components/admin/AdminKit";
import ReturnablesSettings from "@/components/admin/ReturnablesSettings";

type SlotRow = { id: number; key?: string; label: string; labelHi: string };
type Form = { slots: SlotRow[]; codeAbove: string; photoRequired: boolean; lat: string; lng: string };

let nextId = 1;

function toForm(d: Delivery): Form {
  return {
    slots: d.slots.map((s) => ({ id: nextId++, key: s.key, label: s.label, labelHi: s.labelHi ?? "" })),
    codeAbove: d.codeAbove ? String(d.codeAbove / 100) : "",
    photoRequired: d.photoRequired,
    lat: d.depot ? String(d.depot.lat) : "",
    lng: d.depot ? String(d.depot.lng) : "",
  };
}

/** Compare forms without the row ids. */
const sig = (f: Form) => JSON.stringify({ ...f, slots: f.slots.map(({ key, label, labelHi }) => [key ?? "", label.trim(), labelHi.trim()]) });

/** Only the changed fields as the API's `delivery` patch, or an error message. */
function toPatch(f: Form, was: Form): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};
  const slotSig = (x: Form) => JSON.stringify(x.slots.map(({ key, label, labelHi }) => [key ?? "", label.trim(), labelHi.trim()]));
  if (slotSig(f) !== slotSig(was)) {
    if (f.slots.length < 1 || f.slots.length > 6) return "Keep 1 to 6 delivery slots";
    if (f.slots.some((s) => !s.label.trim())) return "Every slot needs a name in English";
    out.slots = f.slots.map((s) => ({ ...(s.key ? { key: s.key } : {}), label: s.label.trim(), labelHi: s.labelHi.trim() }));
  }
  if (f.codeAbove.trim() !== was.codeAbove.trim()) {
    let p = 0;
    if (f.codeAbove.trim()) {
      try {
        p = toPaise(f.codeAbove);
      } catch {
        return "Delivery code amount must be in rupees";
      }
      if (p < 0) return "Delivery code amount can't be less than ₹0";
    }
    out.codeAbove = p;
  }
  if (f.photoRequired !== was.photoRequired) out.photoRequired = f.photoRequired;
  if (f.lat.trim() !== was.lat.trim() || f.lng.trim() !== was.lng.trim()) {
    if (!f.lat.trim() && !f.lng.trim()) out.depot = null;
    else {
      const lat = Number(f.lat);
      const lng = Number(f.lng);
      if (!f.lat.trim() || !f.lng.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return "Warehouse location needs a valid latitude and longitude";
      }
      out.depot = { lat, lng };
    }
  }
  return out;
}

export default function DeliverySettings({ delivery }: { delivery: Delivery }) {
  const [saved, setSaved] = useState(() => toForm(delivery));
  const [f, setF] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = sig(f) !== sig(saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };
  const setSlot = (id: number, patch: Partial<SlotRow>) => set("slots", f.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  async function useMyLocation() {
    setLocating(true);
    setError(null);
    const at = await getLocation();
    setLocating(false);
    if (at.lat === undefined || at.lng === undefined) return setError("Couldn't get your location. Allow location access, or type it in.");
    setF((prev) => ({ ...prev, lat: at.lat!.toFixed(6), lng: at.lng!.toFixed(6) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const patch = toPatch(f, saved);
    if (typeof patch === "string") return setError(patch);
    if (!Object.keys(patch).length) return setF(saved);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      if (data.delivery) {
        const next = toForm(data.delivery);
        setSaved(next);
        setF(next);
      }
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="space-y-5">
        <div id="delivery" className="pt-4 scroll-mt-20">
          <p className="page-kick">Delivery</p>
          <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">Trips and drop-offs</h2>
          <p className="text-sm text-[var(--muted)] mt-1">Slots for trips, proof of delivery, and where trips start.</p>
        </div>

        <section className="card p-5 space-y-4">
          <div>
            <p className="font-heading font-bold">Delivery slots</p>
            <p className="text-sm text-[var(--muted)] mt-1">Each trip goes out in one slot. Renaming a slot keeps its trips.</p>
          </div>
          <ul className="space-y-3">
            {f.slots.map((s, i) => (
              <li key={s.id} className="rounded-2xl border border-[var(--line)] bg-white p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[var(--muted)]">Slot {i + 1}</span>
                  <button
                    type="button"
                    className="btn btn-quiet btn-xs !min-h-[36px]"
                    disabled={f.slots.length <= 1}
                    onClick={() => set("slots", f.slots.filter((x) => x.id !== s.id))}
                    aria-label={`Remove slot ${s.label || i + 1}`}
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" /> Remove
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Name">
                    <input className="input" maxLength={30} placeholder="Morning" value={s.label} onChange={(e) => setSlot(s.id, { label: e.target.value })} />
                  </Field>
                  <Field label="Hindi name">
                    <input className="input" maxLength={30} placeholder="सुबह" value={s.labelHi} onChange={(e) => setSlot(s.id, { labelHi: e.target.value })} />
                  </Field>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-quiet btn-sm !min-h-[44px]"
            disabled={f.slots.length >= 6}
            onClick={() => set("slots", [...f.slots, { id: nextId++, label: "", labelHi: "" }])}
          >
            <Icon name="plus" className="h-4 w-4" /> Add slot
          </button>
          {f.slots.length >= 6 && <p className="text-xs text-[var(--muted)]">Up to 6 slots.</p>}
        </section>

        <section className="card p-5 space-y-4">
          <p className="font-heading font-bold">Proof of delivery</p>
          <label className="block max-w-sm">
            <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Ask for the retailer&apos;s delivery code on orders above (₹)</span>
            <input className="input" inputMode="decimal" placeholder="Off" value={f.codeAbove} onChange={(e) => set("codeAbove", e.target.value)} />
            <span className="block text-xs text-[var(--muted)] mt-1">
              The retailer sees a code for big orders and tells it to the driver on handover. Blank or 0 = off.
            </span>
          </label>
          <Toggle
            checked={f.photoRequired}
            onChange={(v) => set("photoRequired", v)}
            label="Delivery photo required"
            hint="The driver must take a photo of the goods at the shop before marking it delivered."
          />
        </section>

        <section className="card p-5 space-y-4">
          <div>
            <p className="font-heading font-bold flex items-center gap-2">
              <Icon name="pin" className="h-5 w-5" /> Warehouse location
            </p>
            <p className="text-sm text-[var(--muted)] mt-1">Where trips start. Auto route order begins from here. Leave blank to start from the first stop.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <Field label="Latitude">
              <input className="input" inputMode="decimal" placeholder="18.5204" value={f.lat} onChange={(e) => set("lat", e.target.value.trim())} />
            </Field>
            <Field label="Longitude">
              <input className="input" inputMode="decimal" placeholder="73.8567" value={f.lng} onChange={(e) => set("lng", e.target.value.trim())} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" disabled={locating} onClick={useMyLocation}>
              <Icon name="pin" className="h-4 w-4" /> {locating ? "Finding you…" : "Use my location"}
            </button>
            {(f.lat || f.lng) && (
              <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={() => setF((p) => ({ ...p, lat: "", lng: "" }))}>
                Clear
              </button>
            )}
          </div>
          <p className="text-xs text-[var(--muted)]">Tip: stand at the warehouse when you tap &ldquo;Use my location&rdquo;.</p>
        </section>

        <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
          <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm min-w-0">
              {error ? (
                <span className="text-[var(--risk-text)]">{error}</span>
              ) : dirty ? (
                <span className="text-[var(--ink-2)]">Unsaved delivery changes.</span>
              ) : savedAt ? (
                <span className="text-[var(--success-text)] inline-flex items-center gap-1.5">
                  <Icon name="check" className="h-4 w-4" />
                  Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </span>
              ) : (
                <span className="text-[var(--muted)]">Delivery settings saved.</span>
              )}
            </p>
            <div className="flex gap-2">
              {dirty && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={busy}
                  onClick={() => {
                    setF(saved);
                    setError(null);
                  }}
                >
                  Undo
                </button>
              )}
              <button type="submit" className="btn btn-kesar btn-sm" disabled={!dirty || busy}>
                {busy ? "Saving…" : dirty ? "Save delivery settings" : "Saved"}
              </button>
            </div>
          </div>
        </div>
      </form>

      <ReturnablesSettings />
    </div>
  );
}
