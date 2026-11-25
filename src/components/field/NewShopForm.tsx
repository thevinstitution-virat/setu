"use client";

import { useRef, useState } from "react";
import Icon from "@/components/Icon";
import {
  ApiError,
  ErrorBox,
  Field,
  Flash,
  SearchPick,
  Sheet,
  Thumb,
  areaOptions,
  errText,
  send,
  shortDate,
  uploadImage,
  useFetch,
  type RegionRow,
} from "@/components/admin/AdminKit";
import { getLocation } from "@/lib/geo";
import { validFssai, validMobile } from "@/lib/field-math";

type LeadStatus = "PENDING" | "APPROVED" | "REJECTED";
type Lead = {
  id: string;
  outletName: string;
  ownerName: string;
  phone: string;
  gstin: string | null;
  shopNumber: string;
  complexName: string;
  pinCode: string;
  area: { name: string } | null;
  photoKey: string | null;
  note: string | null;
  status: LeadStatus;
  createdAt: string;
  createdBy: { name: string } | null;
  decidedBy: { name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
};

type Form = {
  outletName: string;
  ownerName: string;
  phone: string;
  complexName: string;
  shopNumber: string;
  pinCode: string;
  areaId: string | null;
  gstin: string;
  fssai: string;
  note: string;
};

const EMPTY: Form = {
  outletName: "",
  ownerName: "",
  phone: "",
  complexName: "",
  shopNumber: "",
  pinCode: "",
  areaId: null,
  gstin: "",
  fssai: "",
  note: "",
};

const STATUS: Record<LeadStatus, [string, string]> = {
  PENDING: ["Waiting for approval", "st-placed"],
  APPROVED: ["Approved", "st-delivered"],
  REJECTED: ["Not approved", "st-cancelled"],
};

const digits = (s: string, n: number) => s.replace(/\D/g, "").slice(0, n);

function check(f: Form): string | null {
  if (!f.outletName.trim()) return "Enter the shop name";
  if (!f.ownerName.trim()) return "Enter the owner's name";
  if (!validMobile(f.phone)) return "Enter a 10-digit mobile number";
  if (!f.complexName.trim() || !f.shopNumber.trim()) return "Enter the shop number and building / market";
  if (!/^\d{6}$/.test(f.pinCode)) return "Enter the 6-digit PIN code";
  if (!f.areaId) return "Pick the area";
  if (f.gstin.trim() && f.gstin.trim().length !== 15) return "GSTIN has 15 letters and numbers";
  if (f.fssai.trim() && !validFssai(f.fssai.trim())) return "FSSAI number must be 14 digits";
  return null;
}

/**
 * Propose a new shop from the field: details, a photo of the shop front and
 * the phone's location. The office approves it before it can order.
 */
export default function NewShopForm({ onSaved, onCancel }: { onSaved?: (name: string) => void; onCancel?: () => void }) {
  const regions = useFetch<{ regions: RegionRow[] }>("/api/regions");
  const [f, setF] = useState<Form>(EMPTY);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [loc, setLoc] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [locBusy, setLocBusy] = useState(false);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clashes, setClashes] = useState<string[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setError(null);
    if (k === "phone" || k === "gstin") setClashes([]);
  };

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setPhotoErr(null);
    try {
      setPhoto(await uploadImage(file, "store-photo"));
    } catch (e) {
      setPhotoErr(errText(e));
    } finally {
      setPhotoBusy(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  async function locate() {
    setLocBusy(true);
    setLocErr(null);
    const l = await getLocation();
    setLocBusy(false);
    if (l.lat === undefined || l.lng === undefined) {
      setLocErr("Could not get your location. Turn on location for this app and try again.");
      return;
    }
    setLoc({ lat: l.lat, lng: l.lng, accuracy: l.accuracy });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setClashes([]);
    const bad = check(f);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      await send("/api/leads", "POST", {
        outletName: f.outletName.trim(),
        ownerName: f.ownerName.trim(),
        phone: f.phone,
        complexName: f.complexName.trim(),
        shopNumber: f.shopNumber.trim(),
        pinCode: f.pinCode,
        areaId: f.areaId,
        gstin: f.gstin.trim().toUpperCase() || undefined,
        fssai: f.fssai.trim() || undefined,
        note: f.note.trim() || undefined,
        photoKey: photo ?? undefined,
        ...(loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy } : {}),
      });
      const name = f.outletName.trim();
      setF(EMPTY);
      setPhoto(null);
      setLoc(null);
      onSaved?.(name);
    } catch (e) {
      const list = e instanceof ApiError && Array.isArray(e.data.clashes) ? (e.data.clashes as string[]) : [];
      if (list.length) setClashes(list);
      else setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <Field label="Shop name">
        <input className="input" value={f.outletName} maxLength={120} onChange={(e) => set("outletName", e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Owner's name">
        <input className="input" value={f.ownerName} maxLength={120} onChange={(e) => set("ownerName", e.target.value)} autoComplete="off" />
      </Field>
      <Field label="Owner's mobile" hint="The shop signs in with this number.">
        <input
          className="input"
          inputMode="numeric"
          value={f.phone}
          placeholder="10 digits"
          onChange={(e) => set("phone", digits(e.target.value, 10))}
          autoComplete="off"
        />
      </Field>
      <Field label="Building / market">
        <input className="input" value={f.complexName} maxLength={120} onChange={(e) => set("complexName", e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Shop number">
          <input className="input" value={f.shopNumber} maxLength={40} onChange={(e) => set("shopNumber", e.target.value)} />
        </Field>
        <Field label="PIN code">
          <input
            className="input"
            inputMode="numeric"
            value={f.pinCode}
            placeholder="6 digits"
            onChange={(e) => set("pinCode", digits(e.target.value, 6))}
          />
        </Field>
      </div>
      <Field label="Area">
        {regions.error && !regions.data ? (
          <ErrorBox message={regions.error} onRetry={regions.reload} />
        ) : !regions.data ? (
          <p className="text-sm text-[var(--muted)]">Loading areas…</p>
        ) : (
          <SearchPick
            options={areaOptions(regions.data.regions)}
            value={f.areaId}
            onChange={(id) => set("areaId", id)}
            placeholder="Search an area"
          />
        )}
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="GSTIN (optional)">
          <input
            className="input uppercase"
            value={f.gstin}
            maxLength={15}
            onChange={(e) => set("gstin", e.target.value.replace(/\s/g, "").toUpperCase())}
            autoComplete="off"
          />
        </Field>
        <Field label="FSSAI number (optional)">
          <input
            className="input"
            inputMode="numeric"
            value={f.fssai}
            placeholder="14 digits"
            onChange={(e) => set("fssai", digits(e.target.value, 14))}
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-[var(--ink-2)]">Photo of the shop</p>
        <div className="flex items-center gap-3">
          <Thumb imageKey={photo} className="h-20 w-28" alt="Shop photo" />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" disabled={photoBusy} onClick={() => photoInput.current?.click()}>
              <Icon name="image" className="h-4 w-4" />
              {photoBusy ? "Uploading…" : photo ? "Take again" : "Take photo"}
            </button>
            {photo && (
              <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" disabled={photoBusy} onClick={() => setPhoto(null)}>
                Remove
              </button>
            )}
          </div>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
        </div>
        {photoErr && <p className="text-xs text-[var(--risk-text)]">{photoErr}</p>}
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-[var(--ink-2)]">Shop location</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" disabled={locBusy} onClick={locate}>
            <Icon name="pin" className="h-4 w-4" />
            {locBusy ? "Finding you…" : loc ? "Use my location again" : "Use my location"}
          </button>
          {loc && (
            <span className="text-xs text-[var(--success-text)]">
              Saved{loc.accuracy != null ? ` (±${Math.round(loc.accuracy)} m)` : ""}
              {loc.accuracy != null && loc.accuracy > 100 ? ". Not very exact: step outside and try again." : ""}
            </span>
          )}
        </div>
        {!loc && !locErr && <p className="text-xs text-[var(--muted)]">Stand at the shop and tap this, so drivers can find it.</p>}
        {locErr && <p className="text-xs text-[var(--risk-text)]">{locErr}</p>}
      </div>

      <Field label="Note for the office (optional)">
        <textarea className="input min-h-[80px]" maxLength={500} value={f.note} onChange={(e) => set("note", e.target.value)} />
      </Field>

      {clashes.length > 0 && (
        <div className="rounded-xl bg-[var(--risk-tint)] px-3 py-2.5 space-y-1">
          <p className="text-sm font-semibold text-[var(--risk-text)]">This shop may already exist</p>
          <ul className="list-disc pl-5 text-sm text-[var(--risk-text)]">
            {clashes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}

      <div className="flex gap-2">
        {onCancel && (
          <button type="button" className="btn btn-quiet flex-1 min-h-[48px]" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-kesar flex-[2] min-h-[48px]" disabled={busy || photoBusy}>
          {busy ? "Sending…" : "Send for approval"}
        </button>
      </div>
    </form>
  );
}

/** Shops I proposed, newest first, with their status and the office's note when refused. */
export function MyShops() {
  const { data, error, reload } = useFetch<{ leads: Lead[] }>("/api/leads");

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <div className="card p-4 text-sm text-[var(--muted)]">Loading your shops…</div>;
  if (!data.leads.length) {
    return (
      <div className="card p-6 text-center space-y-2">
        <span className="icon-tile mx-auto bg-[var(--accent-tint)] text-[var(--accent-text)]">
          <Icon name="plus" />
        </span>
        <p className="text-sm text-[var(--ink-2)]">No new shops added yet.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {data.leads.map((l) => {
        const [label, cls] = STATUS[l.status];
        return (
          <li key={l.id} className="card p-3 flex gap-3">
            <Thumb imageKey={l.photoKey} className="h-14 w-14" alt="" />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <p className="font-bold text-sm truncate">{l.outletName}</p>
                <span className={`st ${cls} text-[11px] px-2 py-0.5 rounded-full shrink-0`}>{label}</span>
              </div>
              <p className="text-xs text-[var(--muted)] truncate">
                {l.ownerName} · {l.phone}
              </p>
              <p className="text-xs text-[var(--muted)] truncate">
                {l.shopNumber}, {l.complexName}
                {l.area?.name ? ` · ${l.area.name}` : ""} · {l.pinCode}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                Added {shortDate(l.createdAt)}
                {l.createdBy?.name ? ` by ${l.createdBy.name}` : ""}
              </p>
              {l.status === "REJECTED" && l.decisionNote && (
                <p className="text-xs text-[var(--risk-text)]">
                  {l.decidedBy?.name ? `${l.decidedBy.name}: ` : ""}
                  {l.decisionNote}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The whole "New shops" screen: add button (form in a sheet) and my list. */
export function ShopsScreen() {
  const [adding, setAdding] = useState(false);
  const [tick, setTick] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="page-kick">In the field</p>
          <h1 className="page-title">New shops</h1>
          <p className="page-sub">Add a shop you met. The office checks it before it can order.</p>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-kesar w-full min-h-[48px]"
        onClick={() => {
          setFlash(null);
          setAdding(true);
        }}
      >
        <Icon name="plus" className="h-4 w-4" /> Add a new shop
      </button>
      <Flash text={flash} />
      <section className="space-y-2">
        <h2 className="font-bold text-base">Shops you added</h2>
        <MyShops key={tick} />
      </section>
      {adding && (
        <Sheet title="Add a new shop" onClose={() => setAdding(false)}>
          <NewShopForm
            onCancel={() => setAdding(false)}
            onSaved={(name) => {
              setAdding(false);
              setTick((t) => t + 1);
              setFlash(`${name} sent for approval.`);
            }}
          />
        </Sheet>
      )}
    </div>
  );
}
