"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { ApiError, ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";
import { plural, type TripStatus } from "@/components/dispatch/kit";

export type LoadRow = {
  productId: string;
  name: string;
  unit: string;
  caseSize: number | null;
  need: number;
  otherNeed: number;
  inVan: number;
  buffer: number;
  forOrders: number;
  suggested: number;
  warehouse: number;
  loaded: number;
  picks: { batch: string; expiry: string | null; qty: number }[];
};

export type LoadPlan = {
  enabled: boolean;
  vehicle: { id: string; number: string } | null;
  status: TripStatus;
  warehouse: { id: string; name: string } | null;
  van?: { id: string; name: string };
  rows: LoadRow[];
};

export type StockShort = { productId: string; name: string; unit: string; need: number; have: number };

/** Read stockShort from a 409 answer (start trip, load van, add orders). */
export function stockShortOf(e: unknown): StockShort[] | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const s = e.data.stockShort;
  return Array.isArray(s) && s.length ? (s as StockShort[]) : null;
}

/** "3 Dec" from a @db.Date ISO string. */
export const expiryText = (iso: string | null) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "";

/** List of products the warehouse records are short of. */
export function ShortList({ rows, place }: { rows: StockShort[]; place?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-[var(--scheme-text)] flex items-start gap-1.5">
        <Icon name="alert" className="h-4 w-4 shrink-0 mt-0.5" /> The records show less in {place ?? "the warehouse"} than this needs:
      </p>
      <ul className="text-sm text-[var(--ink-2)] space-y-0.5 pl-6 list-disc">
        {rows.map((r) => (
          <li key={r.productId} className="break-words">
            {r.name}: need {r.need}, records show {r.have} {r.unit}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Van stock before and during a trip: what the trip needs, what is already
 * in the van, the spot-sale buffer and how much to load from the warehouse.
 * Shows nothing when stock tracking is off.
 */
export default function VanLoad({ tripId, version, onDone }: { tripId: string; version: number; onDone: (msg?: string) => void }) {
  const { data, error, reload } = useFetch<LoadPlan>(`/api/trips/${tripId}/load?v=${version}`);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [short, setShort] = useState<StockShort[] | null>(null);

  if (error && !data) return <ErrorBox message={`Van stock: ${error}`} onRetry={reload} />;
  if (!data || !data.enabled) return null;

  if (!data.vehicle) {
    return (
      <p className="card p-3 text-sm text-[var(--ink-2)] flex items-center gap-2">
        <Icon name="truck" className="h-4 w-4 shrink-0 text-[var(--muted)]" /> Pick a van to track van stock.
      </p>
    );
  }

  const rows = data.rows;
  const started = data.status === "STARTED";
  const value = (r: LoadRow) => qty[r.productId] ?? String(r.suggested);
  const todo = rows.map((r) => ({ r, n: Number(value(r)) }));
  const bad = todo.find((t) => value(t.r).trim() !== "" && (!Number.isInteger(t.n) || t.n < 0));
  const send_ = todo.filter((t) => Number.isInteger(t.n) && t.n > 0).map((t) => ({ productId: t.r.productId, qty: t.n }));
  const total = send_.reduce((a, t) => a + t.qty, 0);

  async function load(override: boolean) {
    if (bad) return setFailed(`${bad.r.name}: enter a whole number`);
    if (!send_.length) return setFailed("Nothing to load");
    setBusy(true);
    setFailed(null);
    try {
      await send(`/api/trips/${tripId}/load`, "POST", { rows: send_, ...(override ? { override: true } : {}) });
      setShort(null);
      setQty({});
      onDone(`Van loaded: ${plural(send_.length, "product")}, ${total} units.`);
    } catch (e) {
      const s = stockShortOf(e);
      if (s && !override) setShort(s);
      else setFailed(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3.5 border-b border-[var(--line)]">
        <div className="min-w-0">
          <h2 className="font-heading font-bold flex items-center gap-2">
            <Icon name="stock" className="h-5 w-5" /> Van stock
          </h2>
          <p className="text-xs text-[var(--muted)]">
            {data.vehicle.number}
            {data.warehouse ? ` · loads from ${data.warehouse.name}` : ""}
          </p>
        </div>
        {started && <span className="chip chip-kesar !py-0.5 !px-2 !text-[11.5px]">Top up</span>}
      </div>

      {rows.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--muted)]">Nothing to load yet. Add orders to the trip first.</p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--line)]">
            {rows.map((r) => {
              const v = value(r);
              const n = Number(v);
              const over = Number.isInteger(n) && n > r.warehouse;
              const cases = r.caseSize && r.caseSize > 1 && Number.isInteger(n) && n > 0 && n % r.caseSize === 0 ? n / r.caseSize : null;
              return (
                <li key={r.productId} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold break-words">{r.name}</p>
                      <p className="text-xs text-[var(--ink-2)] mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
                        <span>
                          Need <b>{r.need}</b>
                          {r.otherNeed > 0 ? ` + ${r.otherNeed} other trips` : ""}
                        </span>
                        <span>
                          In van <b>{r.inVan}</b>
                        </span>
                        {r.buffer > 0 && <span>Buffer {r.buffer}</span>}
                        {r.loaded > 0 && <span className="text-[var(--success-text)]">Loaded {r.loaded}</span>}
                      </p>
                      <p className={`text-xs mt-0.5 ${over ? "text-[var(--scheme-text)] font-semibold" : "text-[var(--muted)]"}`}>
                        Warehouse {r.warehouse} {r.unit}
                        {over ? " · less than you're loading" : ""}
                      </p>
                      {r.picks.length > 0 && (
                        <p className="text-[11px] text-[var(--muted)] mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <Icon name="layers" className="h-3.5 w-3.5 shrink-0" />
                          {r.picks.map((p, i) => (
                            <span key={i} className="whitespace-nowrap">
                              {p.batch || "No batch"}
                              {p.expiry ? ` · exp ${expiryText(p.expiry)}` : ""} · {p.qty}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <label className="shrink-0 w-[5.5rem] text-right">
                      <span className="block text-[11px] font-medium text-[var(--ink-2)] mb-0.5">To load</span>
                      <input
                        className="input text-right !px-2"
                        inputMode="numeric"
                        aria-label={`Load ${r.name}`}
                        value={v}
                        onChange={(e) => {
                          setQty({ ...qty, [r.productId]: e.target.value.replace(/\D/g, "") });
                          setFailed(null);
                          setShort(null);
                        }}
                      />
                      <span className="block text-[11px] text-[var(--muted)] mt-0.5 truncate">{cases !== null ? `${cases} cases` : r.unit}</span>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="px-4 py-3 border-t border-[var(--line)] space-y-3">
            {short ? (
              <div className="rounded-2xl bg-[var(--scheme-tint)] p-3 space-y-2">
                <ShortList rows={short} place={data.warehouse?.name} />
                <p className="text-xs text-[var(--ink-2)]">If the goods are really there, load anyway: the missing units are booked into the warehouse first.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy} onClick={() => load(true)}>
                    {busy ? "Loading…" : "Load anyway (the goods are there)"}
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" disabled={busy} onClick={() => setShort(null)}>
                    Not now
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-[var(--ink-2)]">
                  {total > 0 ? `${total} units to load` : "The van has enough for the orders."}
                </p>
                <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy || total === 0} onClick={() => load(false)}>
                  <Icon name="truck" className="h-4 w-4" /> {busy ? "Loading…" : "Load van"}
                </button>
              </div>
            )}
            {!started && <p className="text-xs text-[var(--muted)]">Starting the trip also loads whatever the orders still need.</p>}
            {failed && <p className="text-sm text-[var(--risk-text)]">{failed}</p>}
          </div>
        </>
      )}
    </section>
  );
}
