"use client";

import { useState } from "react";
import { PREF_LABEL } from "@/lib/delivery-settings";

type Pref = keyof typeof PREF_LABEL;

/** How the shop wants goods handed over, and a note the driver sees at every drop. */
export default function DeliveryPrefsCard({ pref: pref0, note: note0 }: { pref: Pref | null; note: string | null }) {
  const [saved, setSaved] = useState({ pref: pref0, note: note0 ?? "" });
  const [pref, setPref] = useState<Pref | null>(pref0);
  const [note, setNote] = useState(note0 ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = pref !== saved.pref || note.trim() !== saved.note;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/retailer/delivery-prefs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryPref: pref, deliveryNote: note.trim() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Could not save");
      const next = { pref: (d.deliveryPref ?? null) as Pref | null, note: d.deliveryNote ?? "" };
      setSaved(next);
      setPref(next.pref);
      setNote(next.note);
      setMsg({ ok: true, text: "Saved. Drivers will see this." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  }

  const choices: [Pref | null, string][] = [...(Object.entries(PREF_LABEL) as [Pref, string][]), [null, "No preference"]];

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="font-bold text-base">Delivery preferences</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">The driver sees this when bringing your goods.</p>
      </div>

      <div className="space-y-2" role="radiogroup" aria-label="How to hand over">
        <p className="text-xs font-semibold text-[var(--ink-2)]">How to hand over</p>
        {choices.map(([k, label]) => (
          <label
            key={k ?? "none"}
            className={`flex items-center gap-3 rounded-xl px-3 min-h-[48px] cursor-pointer border ${
              pref === k ? "border-[var(--ink)] bg-white" : "border-transparent bg-black/[0.04]"
            }`}
          >
            <input
              type="radio"
              name="delivery-pref"
              checked={pref === k}
              onChange={() => setPref(k)}
              className="h-5 w-5 accent-[var(--mor)]"
            />
            <span className="text-sm font-semibold">{label}</span>
          </label>
        ))}
      </div>

      <label className="block">
        <span className="text-xs font-semibold text-[var(--ink-2)]">Note for the driver</span>
        <input
          className="input mt-1"
          maxLength={140}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Use the back gate after 2 pm"
        />
      </label>

      {msg && <p className={`text-sm ${msg.ok ? "text-[var(--success-text)]" : "text-[var(--risk-text)]"}`}>{msg.text}</p>}
      <button type="button" className="btn btn-kesar w-full" onClick={save} disabled={busy || !dirty}>
        {busy ? "Saving…" : "Save"}
      </button>
    </section>
  );
}
