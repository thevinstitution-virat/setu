"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";
import { plural } from "@/components/dispatch/kit";
import type { LoadPlan } from "@/components/dispatch/VanLoad";

type UnloadRow = { productId: string; name: string; unit: string; onHand: number; expired: number; reserved: number; good: number; damaged: number; keep: number };
type UnloadPlan = { vehicleId: string | null; rows: UnloadRow[] };
type Counts = { good: string; damaged: string; keep: string };
type Result = { back: number; damaged: number; kept: number; missing: { productId: string; qty: number }[]; found: { productId: string; qty: number }[] };

const FIELDS: { key: keyof Counts; label: string }[] = [
  { key: "good", label: "Good back" },
  { key: "damaged", label: "Damaged" },
  { key: "keep", label: "Keep in van" },
];

const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

/**
 * After a closed trip: count what came back on the van. Good goes back to
 * the warehouse, damaged to the damaged bin, the rest can stay in the van.
 * Shows nothing when stock tracking is off or the van is empty.
 */
export default function VanUnload({ tripId, version, onDone }: { tripId: string; version: number; onDone: (msg?: string) => void }) {
  const plan = useFetch<LoadPlan>(`/api/trips/${tripId}/load?v=${version}`);
  const enabled = !!plan.data?.enabled && !!plan.data.vehicle;
  const unload = useFetch<UnloadPlan>(enabled ? `/api/trips/${tripId}/unload?v=${version}` : null);
  const [counts, setCounts] = useState<Record<string, Counts>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [result, setResult] = useState<{ r: Result; names: Map<string, string>; units: Map<string, string> } | null>(null);

  if (plan.error && !plan.data) return <ErrorBox message={`Van stock: ${plan.error}`} onRetry={plan.reload} />;
  if (!enabled) return null;

  if (result) return <UnloadResult result={result.r} names={result.names} units={result.units} onClose={() => setResult(null)} />;

  if (unload.error && !unload.data) return <ErrorBox message={`Van stock: ${unload.error}`} onRetry={unload.reload} />;
  if (!unload.data || unload.data.rows.length === 0) return null;

  const rows = unload.data.rows;
  const get = (r: UnloadRow): Counts => counts[r.productId] ?? { good: String(r.good), damaged: String(r.damaged), keep: String(r.keep) };
  const lines = rows.map((r) => {
    const c = get(r);
    const n = { good: num(c.good), damaged: num(c.damaged), keep: num(c.keep) };
    const ok = Object.values(n).every((v) => Number.isInteger(v) && v >= 0);
    const missing = ok ? r.onHand - n.good - n.damaged - n.keep : 0;
    return { r, c, n, ok, missing };
  });
  const missingTotal = lines.reduce((a, l) => a + Math.max(0, l.missing), 0);
  const extraTotal = lines.reduce((a, l) => a + Math.max(0, -l.missing), 0);

  function set(r: UnloadRow, key: keyof Counts, v: string) {
    setCounts({ ...counts, [r.productId]: { ...get(r), [key]: v.replace(/\D/g, "") } });
    setFailed(null);
  }

  async function submit() {
    const bad = lines.find((l) => !l.ok);
    if (bad) return setFailed(`${bad.r.name}: counts must be whole numbers`);
    setBusy(true);
    setFailed(null);
    try {
      const res = await send<{ result: Result }>(`/api/trips/${tripId}/unload`, "POST", {
        rows: lines.map((l) => ({ productId: l.r.productId, ...l.n })),
        note: note.trim() || null,
      });
      setResult({ r: res.result, names: new Map(rows.map((r) => [r.productId, r.name])), units: new Map(rows.map((r) => [r.productId, r.unit])) });
      setCounts({});
      setNote("");
      onDone(`Van unloaded: ${res.result.back} back in the warehouse.`);
    } catch (e) {
      setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[var(--line)]">
        <h2 className="font-heading font-bold flex items-center gap-2">
          <Icon name="stock" className="h-5 w-5" /> Unload the van
        </h2>
        <p className="text-xs text-[var(--muted)]">
          {plan.data?.vehicle?.number} · count what came back. Good goes to {plan.data?.warehouse?.name ?? "the warehouse"}, damaged to the damaged bin.
        </p>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {lines.map(({ r, c, missing }) => (
          <li key={r.productId} className="px-4 py-3 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <p className="text-sm font-semibold break-words min-w-0">{r.name}</p>
              <p className="text-xs text-[var(--ink-2)] shrink-0">
                On van <b>{r.onHand}</b> {r.unit}
                {r.expired > 0 && <span className="text-[#a8281e]"> · {r.expired} expired</span>}
              </p>
            </div>
            {r.reserved > 0 && <p className="text-[11px] text-[var(--muted)]">{r.reserved} needed by the van&apos;s next trips: keep them in the van if it goes out again.</p>}
            <div className="grid grid-cols-3 gap-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="block min-w-0">
                  <span className="block text-[11px] font-medium text-[var(--ink-2)] mb-0.5 truncate">{f.label}</span>
                  <input
                    className="input text-right !px-2"
                    inputMode="numeric"
                    aria-label={`${f.label}: ${r.name}`}
                    value={c[f.key]}
                    onChange={(e) => set(r, f.key, e.target.value)}
                  />
                </label>
              ))}
            </div>
            {missing !== 0 && (
              <p className={`text-xs font-semibold ${missing > 0 ? "text-[#a8281e]" : "text-[var(--genda-text)]"}`}>
                {missing > 0 ? `${missing} ${r.unit} missing from the van` : `${-missing} ${r.unit} more than the records show`}
              </p>
            )}
          </li>
        ))}
      </ul>
      <div className="px-4 py-3 border-t border-[var(--line)] space-y-3">
        {(missingTotal > 0 || extraTotal > 0) && (
          <p className="rounded-xl bg-[var(--genda-tint)] px-3 py-2 text-sm text-[var(--genda-text)]">
            {missingTotal > 0 && `${plural(missingTotal, "unit")} missing will be written off. `}
            {extraTotal > 0 && `${plural(extraTotal, "extra unit")} will be booked in.`}
          </p>
        )}
        <label className="block">
          <span className="block text-sm font-medium text-[var(--ink-2)] mb-1">Note</span>
          <input className="input" maxLength={300} placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex justify-end">
          <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy} onClick={submit}>
            <Icon name="check" className="h-4 w-4" /> {busy ? "Unloading…" : "Unload"}
          </button>
        </div>
        {failed && <p className="text-sm text-[#a8281e]">{failed}</p>}
      </div>
    </section>
  );
}

function UnloadResult({ result, names, units, onClose }: { result: Result; names: Map<string, string>; units: Map<string, string>; onClose: () => void }) {
  const line = (x: { productId: string; qty: number }) => `${names.get(x.productId) ?? "Product"}: ${x.qty} ${units.get(x.productId) ?? ""}`.trim();
  return (
    <section className="card p-4 space-y-3" role="status">
      <div className="flex items-start justify-between gap-2">
        <p className="font-heading font-bold flex items-center gap-2">
          <Icon name="check" className="h-5 w-5 text-[var(--mint-text)]" /> Van unloaded
        </p>
        <button type="button" className="btn btn-quiet btn-xs !px-2 !min-h-[40px] !min-w-[40px]" aria-label="Close" onClick={onClose}>
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Tile n={result.back} label="Back in warehouse" tone="bg-[var(--mint-tint)] text-[var(--mint-text)]" />
        <Tile n={result.damaged} label="Damaged" tone={result.damaged ? "bg-[#fde4e1] text-[#a8281e]" : "bg-ink/5"} />
        <Tile n={result.kept} label="Kept in van" tone="bg-ink/5" />
      </div>
      {result.missing.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold text-[#a8281e]">Missing ({plural(result.missing.length, "product")}), written off</p>
          <ul className="list-disc pl-5 text-[var(--ink-2)]">
            {result.missing.map((m) => (
              <li key={m.productId}>{line(m)}</li>
            ))}
          </ul>
        </div>
      )}
      {result.found.length > 0 && (
        <div className="text-sm">
          <p className="font-semibold text-[var(--genda-text)]">Extra, booked in</p>
          <ul className="list-disc pl-5 text-[var(--ink-2)]">
            {result.found.map((m) => (
              <li key={m.productId}>{line(m)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Tile({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className={`rounded-xl py-2.5 px-1 ${tone}`}>
      <p className="font-heading font-bold text-xl leading-none">{n}</p>
      <p className="text-[11px] mt-1 leading-tight opacity-80">{label}</p>
    </div>
  );
}
