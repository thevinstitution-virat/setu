"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ActiveChip, ErrorBox, Field, errText, readRupees, rupeeText, send, useFetch } from "@/components/admin/AdminKit";

type Returnable = { id: string; name: string; nameHi: string | null; unitCharge: number; active: boolean };

/** Crates & jars: types the driver hands over and takes back, with a charge per missing unit. */
export default function ReturnablesSettings() {
  const { data, error, reload } = useFetch<{ returnables: Returnable[] }>("/api/returnables");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <section className="card p-5 space-y-4">
      <div>
        <p className="font-heading font-bold">Crates &amp; jars</p>
        <p className="text-sm text-[var(--muted)] mt-1">
          Things that go out with the goods and should come back, like crates or 20 L jars. The driver counts them at each shop, and each
          retailer&apos;s khata shows how many they hold.
        </p>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}
      {data && data.returnables.length === 0 && !adding && <p className="text-sm text-[var(--muted)]">None yet.</p>}
      {data && data.returnables.length > 0 && (
        <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] bg-white">
          {data.returnables.map((r) => (
            <li key={r.id} className="p-3">
              {editing === r.id ? (
                <ReturnableForm
                  item={r}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    reload();
                  }}
                />
              ) : (
                <ReturnableRow r={r} onEdit={() => setEditing(r.id)} onChanged={reload} />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white p-3">
          <ReturnableForm
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              reload();
            }}
          />
        </div>
      ) : (
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={() => setAdding(true)}>
          <Icon name="plus" className="h-4 w-4" /> Add crate or jar
        </button>
      )}
    </section>
  );
}

function ReturnableRow({ r, onEdit, onChanged }: { r: Returnable; onEdit: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await send(`/api/returnables/${r.id}`, "PATCH", { active: !r.active });
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold break-words">
            {r.name}
            {r.nameHi && <span className="font-normal text-[var(--muted)]"> · {r.nameHi}</span>}
          </p>
          <p className="text-xs text-[var(--muted)]">{r.unitCharge > 0 ? `${formatINR(r.unitCharge)} per missing one` : "No charge if missing"}</p>
        </div>
        <ActiveChip active={r.active} on="In use" off="Off" />
        <button type="button" className="btn btn-quiet btn-xs !min-h-[36px]" onClick={onEdit} disabled={busy}>
          <Icon name="edit" className="h-3.5 w-3.5" /> Edit
        </button>
        <button type="button" className="btn btn-quiet btn-xs !min-h-[36px]" onClick={toggle} disabled={busy}>
          {r.active ? "Turn off" : "Turn on"}
        </button>
      </div>
      {error && <p className="text-xs text-[var(--risk-text)]">{error}</p>}
    </div>
  );
}

function ReturnableForm({ item, onCancel, onSaved }: { item?: Returnable; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? "");
  const [nameHi, setNameHi] = useState(item?.nameHi ?? "");
  const [charge, setCharge] = useState(item ? rupeeText(item.unitCharge || null) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return setError("Give it a name, like Crate or 20 L jar");
    const p = readRupees(charge);
    if (p === "bad") return setError("Charge must be an amount in rupees");
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), nameHi: nameHi.trim() || null, unitCharge: p ?? 0 };
      if (item) await send(`/api/returnables/${item.id}`, "PATCH", body);
      else await send("/api/returnables", "POST", body);
      onSaved();
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name">
          <input className="input" maxLength={40} placeholder="Crate" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Hindi name">
          <input className="input" maxLength={40} placeholder="क्रेट" value={nameHi} onChange={(e) => setNameHi(e.target.value)} />
        </Field>
        <Field label="Charge per missing one (₹)">
          <input className="input" inputMode="decimal" placeholder="0" value={charge} onChange={(e) => setCharge(e.target.value)} />
        </Field>
      </div>
      {error && <p className="text-sm text-[var(--risk-text)]">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={save} disabled={busy}>
          {busy ? "Saving…" : item ? "Save" : "Add"}
        </button>
      </div>
    </div>
  );
}
