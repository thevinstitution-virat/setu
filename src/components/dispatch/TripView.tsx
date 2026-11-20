"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";
import TripHeader from "@/components/dispatch/TripHeader";
import TripStops from "@/components/dispatch/TripStops";
import { DayClose, LoadSheet } from "@/components/dispatch/TripSummary";
import VanLoad, { ShortList, stockShortOf, type StockShort } from "@/components/dispatch/VanLoad";
import VanUnload from "@/components/dispatch/VanUnload";
import { plural, type TripDetail } from "@/components/dispatch/kit";

/** Print only the trip header and the load sheet: hide the app shell. */
const PRINT_CSS = `@media print {
  header, nav { display: none !important; }
  body { background: #fff !important; }
  main { padding: 0 !important; max-width: none !important; }
  .card { box-shadow: none !important; backdrop-filter: none !important; background: #fff !important; border: 1px solid #ddd !important; }
}`;

export default function TripView({ id }: { id: string }) {
  const { data, error, reload } = useFetch<TripDetail>(`/api/trips/${id}`);
  const [flash, setFlash] = useState<string | null>(null);
  // Bumped on every change so the van stock cards load again.
  const [version, setVersion] = useState(0);

  const done = (msg?: string) => {
    reload();
    setVersion((v) => v + 1);
    if (msg) {
      setFlash(msg);
      setTimeout(() => setFlash(null), 5000);
    }
  };

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink date={null} />
        {error ? <ErrorBox message={error} onRetry={reload} /> : <p className="text-sm text-[var(--muted)]">Loading…</p>}
      </div>
    );
  }

  const { trip, summary, canManage } = data;

  return (
    <div className="space-y-5 print:space-y-3">
      <style>{PRINT_CSS}</style>
      <div className="print:hidden">
        <BackLink date={trip.date} />
      </div>

      <TripHeader data={data} onDone={done} />

      {error && (
        <div className="print:hidden">
          <ErrorBox message={error} onRetry={reload} />
        </div>
      )}
      {flash && (
        <p className="card p-3 text-sm font-semibold text-[var(--mint-text)] bg-[var(--mint-tint)] print:hidden" role="status">
          <Icon name="check" className="inline h-4 w-4 mr-1" />
          {flash}
        </p>
      )}

      {canManage && trip.status !== "CLOSED" && (
        <div className="print:hidden">
          <PrimaryAction data={data} onDone={done} />
        </div>
      )}

      {canManage && (
        <div className="print:hidden">
          {trip.status === "CLOSED" ? (
            <VanUnload tripId={trip.id} version={version} onDone={done} />
          ) : (
            <VanLoad tripId={trip.id} version={version} onDone={done} />
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="space-y-5 min-w-0">
          <div className="print:hidden">
            <TripStops data={data} onDone={done} />
          </div>
          <LoadSheet summary={summary} />
        </div>
        <div className="print:hidden">
          <DayClose summary={summary} status={trip.status} />
        </div>
      </div>
    </div>
  );
}

function BackLink({ date }: { date: string | null }) {
  return (
    <Link href={date ? `/admin/dispatch?date=${date}` : "/admin/dispatch"} className="inline-flex items-center gap-1 text-sm font-bold text-[var(--ink-2)]">
      <Icon name="arrow" className="h-4 w-4 rotate-180" /> Dispatch
    </Link>
  );
}

/** PLANNED → Start trip; STARTED → Close trip (with "Close anyway" when stops are still open). */
function PrimaryAction({ data, onDone }: { data: TripDetail; onDone: (msg?: string) => void }) {
  const { trip, summary } = data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [short, setShort] = useState<StockShort[] | null>(null);

  async function start(stockOverride = false) {
    setBusy(true);
    setError(null);
    try {
      const d = await send<{ stops: number; invoiced: number }>(`/api/trips/${trip.id}/start`, "POST", stockOverride ? { stockOverride: true } : undefined);
      setShort(null);
      onDone(`Trip started: ${plural(d.stops, "order")} out for delivery${d.invoiced ? `, ${plural(d.invoiced, "invoice")} made` : ""}.`);
    } catch (e) {
      const s = stockShortOf(e);
      if (s && !stockOverride) setShort(s);
      else setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function close(force: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${trip.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(force ? { force: true } : {}),
      });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && !force) {
        setBlocked(d.error ?? "Some stops are still open.");
        return;
      }
      if (!res.ok) throw new Error(d.error ?? "Could not close the trip");
      setBlocked(null);
      onDone("Trip closed. Receive the driver's cash under Cash.");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (trip.status === "PLANNED") {
    return (
      <div className="card p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
          <div className="min-w-0">
            <p className="font-heading font-bold">Ready to leave?</p>
            <p className="text-sm text-[var(--muted)]">
              {summary.stops
                ? `Starting sends all ${plural(summary.stops, "order")} out for delivery and puts the driver on duty.`
                : "Add orders from the dispatch board first."}
            </p>
            {error && <p className="text-sm text-[#a8281e] mt-1">{error}</p>}
          </div>
          {!short && (
            <button type="button" className="btn btn-kesar shrink-0" disabled={busy || summary.stops === 0} onClick={() => start(false)}>
              <Icon name="truck" className="h-4 w-4" /> {busy ? "Starting…" : "Start trip"}
            </button>
          )}
        </div>
        {short && (
          <div className="rounded-2xl bg-[var(--genda-tint)] p-3 space-y-2">
            <ShortList rows={short} />
            <p className="text-xs text-[var(--ink-2)]">Starting tops the van up for every order. If the goods are really there, start anyway: the missing units are booked in first.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy} onClick={() => start(true)}>
                {busy ? "Starting…" : "Start anyway"}
              </button>
              <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" disabled={busy} onClick={() => setShort(null)}>
                Not yet
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="min-w-0">
          <p className="font-heading font-bold">Back at the warehouse?</p>
          <p className="text-sm text-[var(--muted)]">
            Closing freezes the load sheet and the day&apos;s figures.
            {summary.pending > 0 ? ` ${plural(summary.pending, "stop is", "stops are")} still open.` : ""}
          </p>
        </div>
        {!blocked && (
          <button type="button" className="btn btn-kesar shrink-0" disabled={busy} onClick={() => close(false)}>
            <Icon name="check" className="h-4 w-4" /> {busy ? "Closing…" : "Close trip"}
          </button>
        )}
      </div>
      {blocked && (
        <div className="rounded-2xl bg-[var(--genda-tint)] p-3 space-y-2">
          <p className="text-sm text-[var(--genda-text)] flex items-start gap-1.5">
            <Icon name="alert" className="h-4 w-4 shrink-0 mt-0.5" /> {blocked}
          </p>
          <p className="text-xs text-[var(--ink-2)]">Close anyway marks the open stops &ldquo;Not delivered: ran out of time&rdquo;. Those orders go back to Ready to go.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" disabled={busy} onClick={() => close(true)}>
              {busy ? "Closing…" : "Close anyway"}
            </button>
            <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" disabled={busy} onClick={() => setBlocked(null)}>
              Not yet
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
    </div>
  );
}
