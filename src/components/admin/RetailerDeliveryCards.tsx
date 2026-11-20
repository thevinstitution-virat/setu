"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { PREF_LABEL } from "@/lib/delivery-settings";
import { api, errText, readInt, send } from "@/components/admin/AdminKit";

/**
 * Khata (admin) cards for one shop: delivery preference / driver note / map
 * pin, and crates & jars held. What the user may change is worked out on the
 * server (khata/[retailerId]/layout.tsx) and passed down through context.
 */

export type KhataPerms = { delivery: boolean; crates: boolean };
const PermsContext = createContext<KhataPerms>({ delivery: false, crates: false });

export function KhataPermsProvider({ value, children }: { value: KhataPerms; children: React.ReactNode }) {
  return <PermsContext.Provider value={value}>{children}</PermsContext.Provider>;
}

type Pref = keyof typeof PREF_LABEL;
type DeliveryInfo = { deliveryPref: Pref | null; deliveryNote: string | null; lat: number | null; lng: number | null };

export default function RetailerDeliveryCards({ retailerId, onDone }: { retailerId: string; onDone: (msg?: string) => Promise<void> }) {
  const perms = useContext(PermsContext);
  return (
    <>
      <DeliveryCard retailerId={retailerId} canEdit={perms.delivery} onDone={onDone} />
      <CratesCard retailerId={retailerId} canEdit={perms.crates} onDone={onDone} />
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold">{title}</h2>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </section>
  );
}

// ───────────────────────────── delivery ─────────────────────────────

function DeliveryCard({ retailerId, canEdit, onDone }: { retailerId: string; canEdit: boolean; onDone: (msg?: string) => Promise<void> }) {
  const [saved, setSaved] = useState<DeliveryInfo | null>(null);
  const [pref, setPref] = useState<Pref | "">("");
  const [note, setNote] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fill = useCallback((d: DeliveryInfo) => {
    setSaved(d);
    setPref(d.deliveryPref ?? "");
    setNote(d.deliveryNote ?? "");
    setLat(d.lat === null ? "" : String(d.lat));
    setLng(d.lng === null ? "" : String(d.lng));
  }, []);

  useEffect(() => {
    let live = true;
    api<DeliveryInfo>(`/api/admin/retailers/${retailerId}/delivery`)
      .then((d) => live && fill(d))
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [retailerId, fill]);

  const pinChanged = !!saved && (lat.trim() !== (saved.lat === null ? "" : String(saved.lat)) || lng.trim() !== (saved.lng === null ? "" : String(saved.lng)));
  const dirty = !!saved && (pref !== (saved.deliveryPref ?? "") || note.trim() !== (saved.deliveryNote ?? "") || pinChanged);

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(true);
    setError(null);
    try {
      fill(await send<DeliveryInfo>(`/api/admin/retailers/${retailerId}/delivery`, "PATCH", body));
      await onDone(msg);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const body: Record<string, unknown> = { deliveryPref: pref || null, deliveryNote: note.trim() || null };
    if (pinChanged) {
      if (!lat.trim() && !lng.trim()) {
        body.lat = null;
        body.lng = null;
      } else {
        const a = Number(lat);
        const b = Number(lng);
        if (!lat.trim() || !lng.trim() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) {
          return setError("The map pin needs a valid latitude and longitude");
        }
        body.lat = a;
        body.lng = b;
      }
    }
    patch(body, "Delivery details saved");
  }

  return (
    <Card title="Delivery">
      {!saved && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      {saved && !canEdit && (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-xs text-[var(--muted)]">Hand over</dt>
            <dd className="font-medium">{saved.deliveryPref ? PREF_LABEL[saved.deliveryPref] : "No preference"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Note for the driver</dt>
            <dd className="font-medium">{saved.deliveryNote ?? "None"}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Map pin</dt>
            <dd className="font-medium">{saved.lat !== null ? `${saved.lat}, ${saved.lng}` : "Not set: taken from the first delivery"}</dd>
          </div>
        </dl>
      )}
      {saved && canEdit && (
        <>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">Hand over</span>
            <select className="input mt-1" value={pref} onChange={(e) => setPref(e.target.value as Pref | "")}>
              <option value="">No preference</option>
              {(Object.keys(PREF_LABEL) as Pref[]).map((k) => (
                <option key={k} value={k}>
                  {PREF_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-[var(--ink-2)]">Note for the driver</span>
            <textarea
              className="input mt-1 min-h-[70px]"
              maxLength={140}
              placeholder="e.g. Back door after 2 pm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div>
            <span className="text-xs font-semibold text-[var(--ink-2)]">Map pin</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <input className="input" inputMode="decimal" aria-label="Latitude" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value.trim())} />
              <input className="input" inputMode="decimal" aria-label="Longitude" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value.trim())} />
            </div>
            <p className="text-xs text-[var(--muted)] mt-1 flex items-start gap-1">
              <Icon name="pin" className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {saved.lat === null ? "Not set: taken from the first delivery." : "Used for route order and the driver's map."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-kesar btn-sm !min-h-[44px] flex-1" disabled={!dirty || busy} onClick={save}>
              {busy ? "Saving…" : "Save"}
            </button>
            {saved.lat !== null && (
              <button
                type="button"
                className="btn btn-quiet btn-sm !min-h-[44px]"
                disabled={busy}
                onClick={() => {
                  if (window.confirm("Clear the map pin? The next delivery sets a new one.")) patch({ lat: null, lng: null }, "Map pin cleared");
                }}
              >
                Clear pin
              </button>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ───────────────────────────── crates & jars ─────────────────────────────

type Balance = { retailerId: string; returnableId: string; balance: number; name: string; unitCharge: number };
type Returnable = { id: string; name: string; nameHi: string | null; unitCharge: number; active: boolean };
type Mode = "charge" | "adjust" | "opening";

function CratesCard({ retailerId, canEdit, onDone }: { retailerId: string; canEdit: boolean; onDone: (msg?: string) => Promise<void> }) {
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [types, setTypes] = useState<Returnable[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([
      api<{ balances: Balance[] }>(`/api/returnables/balances?retailerId=${encodeURIComponent(retailerId)}`),
      api<{ returnables: Returnable[] }>("/api/returnables"),
    ])
      .then(([b, t]) => {
        if (!live) return;
        setBalances(b.balances);
        setTypes(t.returnables);
        setError(null);
      })
      .catch((e) => live && setError(errText(e)));
    return () => {
      live = false;
    };
  }, [retailerId, tick]);

  const finished = async (msg: string) => {
    setMode(null);
    setTick((t) => t + 1);
    await onDone(msg);
  };

  if (!balances) {
    return (
      <Card title="Crates & jars held">
        {error ? <p className="text-sm text-[#a8281e]">{error}</p> : <p className="text-sm text-[var(--muted)]">Loading…</p>}
      </Card>
    );
  }

  const held = balances.filter((b) => b.balance !== 0);
  const chargeable = held.filter((b) => b.balance > 0 && b.unitCharge > 0);

  return (
    <Card title="Crates & jars held">
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      {types.length === 0 && held.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          No crate or jar types set up.{" "}
          <Link href="/admin/settings#delivery" className="font-bold text-[var(--kesar-text)]">
            Add them in Settings
          </Link>
        </p>
      ) : held.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">Holds none of yours.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-white">
          {held.map((b) => (
            <li key={b.returnableId} className="flex items-center justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">{b.name}</span>
                {b.unitCharge > 0 && b.balance > 0 && (
                  <span className="block text-xs text-[var(--muted)]">{formatINR(b.balance * b.unitCharge)} if none come back</span>
                )}
              </span>
              <span className={`font-heading text-lg font-bold shrink-0 ${b.balance < 0 ? "text-[#a8281e]" : ""}`}>{b.balance}</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && types.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["charge", "Charge for missing"],
                ["adjust", "Adjust count"],
                ["opening", "Opening count"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={mode === k}
                onClick={() => setMode(mode === k ? null : k)}
                className={`btn btn-sm !min-h-[40px] ${mode === k ? "btn-mor" : "btn-quiet"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "charge" && <ChargeForm retailerId={retailerId} options={chargeable} onCancel={() => setMode(null)} onDone={finished} />}
          {mode === "adjust" && <CountForm kind="ADJUST" retailerId={retailerId} types={types} onCancel={() => setMode(null)} onDone={finished} />}
          {mode === "opening" && (
            <CountForm kind="OPENING" retailerId={retailerId} types={types.filter((t) => t.active)} onCancel={() => setMode(null)} onDone={finished} />
          )}
        </>
      )}
    </Card>
  );
}

function ChargeForm({
  retailerId,
  options,
  onCancel,
  onDone,
}: {
  retailerId: string;
  options: Balance[];
  onCancel: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [id, setId] = useState(options[0]?.returnableId ?? "");
  const [units, setUnits] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = options.find((o) => o.returnableId === id) ?? null;
  const n = readInt(units, 1);

  if (options.length === 0) {
    return (
      <p className="rounded-2xl bg-ink/5 p-3 text-sm text-[var(--ink-2)]">
        Nothing to charge: the shop holds none, or no charge is set.{" "}
        <Link href="/admin/settings#delivery" className="font-bold text-[var(--kesar-text)]">
          Set charges in Settings
        </Link>
      </p>
    );
  }

  async function save() {
    if (!pick) return setError("Pick what is missing");
    if (typeof n !== "number") return setError("Units must be a whole number above zero");
    if (n > pick.balance) return setError(`The shop holds only ${pick.balance}`);
    setBusy(true);
    setError(null);
    try {
      await send("/api/returnables/moves", "POST", { retailerId, kind: "CHARGE", returnableId: pick.returnableId, units: n, note: note.trim() || undefined });
      await onDone(`Charged ${formatINR(n * pick.unitCharge)} for ${n} ${pick.name}`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-3 space-y-2.5">
      <p className="text-xs text-[var(--ink-2)]">Bills the shop for ones they can&apos;t return and takes them off their count.</p>
      <div className="grid grid-cols-[1fr_6rem] gap-2">
        <label className="block min-w-0">
          <span className="text-xs font-semibold text-[var(--ink-2)]">Missing</span>
          <select className="input mt-1" value={id} onChange={(e) => setId(e.target.value)}>
            {options.map((o) => (
              <option key={o.returnableId} value={o.returnableId}>
                {o.name} ({o.balance} held)
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-[var(--ink-2)]">Units</span>
          <input className="input mt-1" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ""))} />
        </label>
      </div>
      <label className="block">
        <span className="text-xs font-semibold text-[var(--ink-2)]">Note (optional)</span>
        <input className="input mt-1" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {pick && typeof n === "number" && (
        <p className="text-sm">
          {n} × {formatINR(pick.unitCharge)} = <b>{formatINR(n * pick.unitCharge)}</b> added to the bill
        </p>
      )}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={save} disabled={busy}>
          {busy ? "Charging…" : "Charge"}
        </button>
      </div>
    </div>
  );
}

/** ADJUST: given / taken per type with a required note. OPENING: count each type the shop already holds. */
function CountForm({
  kind,
  retailerId,
  types,
  onCancel,
  onDone,
}: {
  kind: "ADJUST" | "OPENING";
  retailerId: string;
  types: Returnable[];
  onCancel: () => void;
  onDone: (msg: string) => Promise<void>;
}) {
  const [given, setGiven] = useState<Record<string, string>>({});
  const [taken, setTaken] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opening = kind === "OPENING";

  async function save() {
    const rows: { returnableId: string; given: number; taken: number }[] = [];
    for (const t of types) {
      const g = readInt(given[t.id] ?? "");
      const k = opening ? 0 : readInt(taken[t.id] ?? "");
      if (g === "bad" || k === "bad") return setError("Counts must be whole numbers");
      if ((g ?? 0) > 0 || (k ?? 0) > 0) rows.push({ returnableId: t.id, given: g ?? 0, taken: k ?? 0 });
    }
    if (!rows.length) return setError(opening ? "Enter how many the shop holds" : "Enter a count to change");
    if (!opening && !note.trim()) return setError("Write why the count changed");
    setBusy(true);
    setError(null);
    try {
      await send("/api/returnables/moves", "POST", { retailerId, kind, rows, note: note.trim() || undefined });
      await onDone(opening ? "Opening count saved" : "Count adjusted");
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  if (types.length === 0) return <p className="text-sm text-[var(--muted)]">No crate or jar types in use.</p>;

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-3 space-y-2.5">
      <p className="text-xs text-[var(--ink-2)]">
        {opening
          ? "For a shop moving onto VBiz Pro: how many of each it already holds."
          : "Fix the count after a recount. Given adds to what the shop holds, taken back removes."}
      </p>
      <ul className="space-y-2">
        {types.map((t) => (
          <li key={t.id} className={opening ? "flex items-center gap-2" : "space-y-1"}>
            <p className={`text-sm font-semibold min-w-0 ${opening ? "flex-1 truncate" : ""}`}>
              {t.name}
              {!t.active && <span className="font-normal text-[var(--muted)]"> (off)</span>}
            </p>
            {opening ? (
              <input
                className="input !w-24 shrink-0"
                inputMode="numeric"
                aria-label={`${t.name} held`}
                placeholder="0"
                value={given[t.id] ?? ""}
                onChange={(e) => setGiven({ ...given, [t.id]: e.target.value.replace(/\D/g, "") })}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[11px] text-[var(--muted)]">Given (+)</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="0"
                    value={given[t.id] ?? ""}
                    onChange={(e) => setGiven({ ...given, [t.id]: e.target.value.replace(/\D/g, "") })}
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] text-[var(--muted)]">Taken back (−)</span>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="0"
                    value={taken[t.id] ?? ""}
                    onChange={(e) => setTaken({ ...taken, [t.id]: e.target.value.replace(/\D/g, "") })}
                  />
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>
      <label className="block">
        <span className="text-xs font-semibold text-[var(--ink-2)]">{opening ? "Note (optional)" : "Why the count changed"}</span>
        <input className="input mt-1" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
