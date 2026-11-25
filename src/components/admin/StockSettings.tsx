"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import type { InventorySettings, OrderCheck } from "@/lib/inventory-settings";
import { Field, Toggle } from "@/components/admin/AdminKit";

type Form = { enabled: boolean; orderCheck: OrderCheck; bufferPct: string; expiryAlertDays: string; purchaseCases: boolean };

const toForm = (s: InventorySettings): Form => ({
  enabled: s.enabled,
  orderCheck: s.orderCheck,
  bufferPct: String(s.bufferPct),
  expiryAlertDays: String(s.expiryAlertDays),
  purchaseCases: s.purchaseCases,
});

const CHECKS: readonly (readonly [OrderCheck, string, string])[] = [
  ["off", "Don't check", "Take every order"],
  ["warn", "Warn", "Show a warning"],
  ["block", "Refuse", "Stop the order"],
];

/** Whole number between min and max, or an error message. */
function wholeIn(s: string, min: number, max: number, what: string): number | string {
  const t = s.trim();
  const n = Number(t);
  if (!t || !Number.isInteger(n) || n < min || n > max) return `${what} must be a whole number from ${min} to ${max}`;
  return n;
}

/** Only the changed fields as the API's `inventory` patch, or an error message. */
function toPatch(f: Form, was: Form): Partial<InventorySettings> | string {
  const out: Partial<InventorySettings> = {};
  if (f.enabled !== was.enabled) out.enabled = f.enabled;
  if (f.orderCheck !== was.orderCheck) out.orderCheck = f.orderCheck;
  if (f.purchaseCases !== was.purchaseCases) out.purchaseCases = f.purchaseCases;
  if (f.bufferPct.trim() !== was.bufferPct) {
    const v = wholeIn(f.bufferPct, 0, 200, "Van extra");
    if (typeof v === "string") return v;
    out.bufferPct = v;
  }
  if (f.expiryAlertDays.trim() !== was.expiryAlertDays) {
    const v = wholeIn(f.expiryAlertDays, 0, 365, "Expiry warning");
    if (typeof v === "string") return v;
    out.expiryAlertDays = v;
  }
  return out;
}

export default function StockSettings({ inventory }: { inventory: InventorySettings }) {
  const [saved, setSaved] = useState(() => toForm(inventory));
  const [f, setF] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const dirty = JSON.stringify({ ...f, bufferPct: f.bufferPct.trim(), expiryAlertDays: f.expiryAlertDays.trim() }) !== JSON.stringify(saved);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setError(null);
  };

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
        body: JSON.stringify({ inventory: patch }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      if (data.inventory) {
        const next = toForm(data.inventory);
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
    <form onSubmit={save} className="space-y-5">
      <div id="stock" className="pt-4 scroll-mt-20">
        <p className="page-kick">Stock</p>
        <h2 className="font-heading font-bold text-xl text-[var(--ink)] mt-1">Stock tracking</h2>
        <p className="text-sm text-[var(--muted)] mt-1">Count stock in warehouses and vans, and check orders against it.</p>
      </div>

      <section className="card p-5 space-y-5">
        <Toggle
          checked={f.enabled}
          onChange={(v) => set("enabled", v)}
          label="Track stock"
          hint="Receiving, van loading, sales and returns move stock. Off: nothing moves and orders aren't checked."
        />

        <div className={`space-y-5 ${f.enabled ? "" : "opacity-60"}`}>
          <div>
            <p className="text-sm font-medium text-[var(--ink-2)] mb-1">When an order asks for more than is in stock</p>
            <div className="flex rounded-2xl p-1 bg-ink/5 max-w-md" role="radiogroup" aria-label="When an order asks for more than is in stock">
              {CHECKS.map(([v, label, hint]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={f.orderCheck === v}
                  onClick={() => set("orderCheck", v)}
                  className={`flex-1 min-h-[44px] rounded-xl py-2 px-2 text-sm font-bold transition ${
                    f.orderCheck === v ? "bg-gradient-to-br from-mor to-[var(--mor-mid)] text-white" : "text-[var(--ink-2)]"
                  }`}
                >
                  {label}
                  <span className={`block text-[11px] font-normal ${f.orderCheck === v ? "text-white/75" : "text-[var(--muted)]"}`}>{hint}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--muted)] mt-1">Checked against stock in the warehouse and vans, less what open orders already need.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 max-w-md">
            <Field label="Extra on the van for spot sales (%)" hint="Added on top of the trip's orders when loading.">
              <input className="input" inputMode="numeric" value={f.bufferPct} onChange={(e) => set("bufferPct", e.target.value.replace(/\D/g, ""))} />
            </Field>
            <Field label="Warn about expiry (days)" hint="Batches expiring this soon are flagged.">
              <input className="input" inputMode="numeric" value={f.expiryAlertDays} onChange={(e) => set("expiryAlertDays", e.target.value.replace(/\D/g, ""))} />
            </Field>
          </div>

          <p className="text-xs text-[var(--muted)] flex items-start gap-1.5">
            <Icon name="stock" className="h-4 w-4 shrink-0" />
            <span>
              Reorder levels and suppliers are set on each product. See stock in{" "}
              <Link href="/admin/stock" className="font-semibold underline">
                Stock
              </Link>
              .
            </span>
          </p>
        </div>

        <div className="border-t border-[var(--line)] pt-5">
          <Toggle
            checked={f.purchaseCases}
            onChange={(v) => set("purchaseCases", v)}
            label="Purchase bill sheets by the case"
            hint="The purchase bill import also reads cases, loose and case_rate (the rate per case), and works each line out as the company's bill does. The case size comes from the product, or a case_size column."
          />
        </div>
      </section>

      <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
        <div className="card p-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm min-w-0">
            {error ? (
              <span className="text-[var(--risk-text)]">{error}</span>
            ) : dirty ? (
              <span className="text-[var(--ink-2)]">Unsaved stock changes.</span>
            ) : savedAt ? (
              <span className="text-[var(--success-text)] inline-flex items-center gap-1.5">
                <Icon name="check" className="h-4 w-4" />
                Saved at {savedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
              </span>
            ) : (
              <span className="text-[var(--muted)]">Stock settings saved.</span>
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
              {busy ? "Saving…" : dirty ? "Save stock settings" : "Saved"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
