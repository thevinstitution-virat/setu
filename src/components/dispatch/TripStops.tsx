"use client";

import { useState } from "react";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { FAIL_REASONS, PREF_LABEL } from "@/lib/delivery-settings";
import { errText, send } from "@/components/admin/AdminKit";
import { OrderLink } from "@/components/dispatch/ReadyOrders";
import { failLabel, plural, type StopJson, type TripDetail } from "@/components/dispatch/kit";

/** Stops in route order with reorder, auto route, remove and "Not delivered". */
export default function TripStops({ data, onDone }: { data: TripDetail; onDone: (msg?: string) => void }) {
  const { trip, stops, directions, canManage } = data;
  const editable = canManage && trip.status !== "CLOSED";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = stops.filter((s) => s.state === "ASSIGNED");
  const located = open.filter((s) => s.retailer.lat !== null).length;

  async function run(fn: () => Promise<string | undefined>) {
    setBusy(true);
    setError(null);
    try {
      onDone(await fn());
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  /** Swap an open stop with the next open stop above (-1) or below (+1). */
  function move(index: number, dir: -1 | 1) {
    let j = index + dir;
    while (j >= 0 && j < stops.length && stops[j].state !== "ASSIGNED") j += dir;
    if (j < 0 || j >= stops.length) return;
    const ids = stops.map((s) => s.orderId);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    run(async () => {
      await send(`/api/trips/${trip.id}/sequence`, "POST", { orderIds: ids });
      return undefined;
    });
  }

  const canMove = (index: number, dir: -1 | 1) => {
    for (let j = index + dir; j >= 0 && j < stops.length; j += dir) if (stops[j].state === "ASSIGNED") return true;
    return false;
  };

  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-[var(--line)] space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading font-bold">Stops</h2>
          <span className="text-sm text-[var(--muted)]">
            {plural(stops.length, "stop")}
            {open.length !== stops.length ? ` · ${open.length} open` : ""}
          </span>
        </div>
        {(directions || (editable && open.length > 1)) && (
          <div className="flex flex-wrap gap-2">
            {editable && open.length > 1 && (
              <button
                type="button"
                className="btn btn-quiet btn-sm !min-h-[44px]"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const d = await send<{ located: number; total: number }>(`/api/trips/${trip.id}/sequence`, "POST", { auto: true });
                    return `Route order set. ${d.located} of ${d.total} stops have a map pin.`;
                  })
                }
              >
                <Icon name="route" className="h-4 w-4" /> Auto route order
              </button>
            )}
            {directions && (
              <a href={directions} target="_blank" rel="noopener noreferrer" className="btn btn-outline btn-sm !min-h-[44px]">
                <Icon name="map" className="h-4 w-4" /> Open route in Google Maps
              </a>
            )}
          </div>
        )}
        {editable && open.length > 1 && (
          <p className="text-xs text-[var(--muted)]">
            {located} of {open.length} open stops have a map pin. Stops without one go last, grouped by area.
          </p>
        )}
        {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      </div>

      {stops.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--muted)]">No stops yet. Add orders from the dispatch board.</p>
      ) : (
        <ol className="divide-y divide-[var(--line)]">
          {stops.map((s, i) => (
            <li key={s.orderId}>
              <StopRow
                s={s}
                tripId={trip.id}
                editable={editable && s.state === "ASSIGNED"}
                canRemove={editable && trip.status === "PLANNED"}
                canFail={editable && trip.status === "STARTED" && s.state === "ASSIGNED"}
                busy={busy}
                up={canMove(i, -1) ? () => move(i, -1) : null}
                down={canMove(i, 1) ? () => move(i, 1) : null}
                run={run}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function StateChip({ s }: { s: StopJson }) {
  if (s.state === "DELIVERED") return <span className="chip chip-mint !py-0.5 !px-2 !text-[11.5px]">Delivered</span>;
  if (s.state === "FAILED")
    return (
      <span className="chip !py-0.5 !px-2 !text-[11.5px] !bg-[#fde4e1] !text-[#a8281e] !border-transparent max-w-full">
        <span className="truncate">Not delivered: {failLabel(s.failReason)}</span>
      </span>
    );
  return <span className="chip chip-genda !py-0.5 !px-2 !text-[11.5px]">Open</span>;
}

function StopRow({
  s,
  tripId,
  editable,
  canRemove,
  canFail,
  busy,
  up,
  down,
  run,
}: {
  s: StopJson;
  tripId: string;
  editable: boolean;
  canRemove: boolean;
  canFail: boolean;
  busy: boolean;
  up: (() => void) | null;
  down: (() => void) | null;
  run: (fn: () => Promise<string | undefined>) => Promise<void>;
}) {
  const [failing, setFailing] = useState(false);
  const pref = s.retailer.deliveryPref ? PREF_LABEL[s.retailer.deliveryPref as keyof typeof PREF_LABEL] : null;
  const done = s.state !== "ASSIGNED";

  return (
    <div className={`px-4 py-3.5 ${done ? "bg-black/[0.02]" : ""}`}>
      <div className="flex items-start gap-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
            s.state === "DELIVERED" ? "bg-[var(--mint-tint)] text-[var(--mint-text)]" : s.state === "FAILED" ? "bg-[#fde4e1] text-[#a8281e]" : "bg-ink text-genda"
          }`}
          aria-label={`Stop ${s.seq ?? ""}`}
        >
          {s.state === "DELIVERED" ? <Icon name="check" className="h-4 w-4" /> : s.seq}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-semibold text-sm break-words">{s.retailer.outletName}</p>
              <p className="text-xs text-[var(--muted)] break-words">{s.retailer.address}</p>
            </div>
            <p className="text-sm font-semibold shrink-0">{formatINR(s.order.total)}</p>
          </div>
          <p className="text-xs text-[var(--ink-2)] flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <OrderLink orderNumber={s.order.orderNumber} />
            <span>{plural(s.order.lines, "line")}</span>
            {s.retailer.phone && (
              <a href={`tel:${s.retailer.phone}`} className="font-semibold text-[var(--kesar-text)]">
                {s.retailer.phone}
              </a>
            )}
          </p>
          {(pref || s.retailer.deliveryNote) && (
            <p className="text-xs text-[var(--ink-2)]">
              {pref && <b>{pref}</b>}
              {pref && s.retailer.deliveryNote ? " · " : ""}
              {s.retailer.deliveryNote}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <StateChip s={s} />
            {s.retailer.lat === null && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
                <Icon name="pin" className="h-3 w-3" /> No map pin
              </span>
            )}
            {s.attempts > 1 && <span className="text-[11px] text-[var(--muted)]">Try {s.attempts}</span>}
          </div>
          {s.state === "FAILED" && s.failNote && <p className="text-xs text-[var(--muted)]">&ldquo;{s.failNote}&rdquo;</p>}
        </div>
      </div>

      {(editable || canRemove) && !failing && (
        <div className="mt-2.5 pl-11 flex flex-wrap gap-2">
          {editable && (
            <>
              <button type="button" className="btn btn-quiet btn-sm !min-h-[40px] !px-3" aria-label="Move up" disabled={busy || !up} onClick={() => up?.()}>
                <Icon name="arrow" className="h-4 w-4 -rotate-90" />
              </button>
              <button type="button" className="btn btn-quiet btn-sm !min-h-[40px] !px-3" aria-label="Move down" disabled={busy || !down} onClick={() => down?.()}>
                <Icon name="arrow" className="h-4 w-4 rotate-90" />
              </button>
            </>
          )}
          {canFail && (
            <button type="button" className="btn btn-quiet btn-sm !min-h-[40px]" disabled={busy} onClick={() => setFailing(true)}>
              Not delivered
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              className="btn btn-danger btn-sm !min-h-[40px]"
              disabled={busy}
              onClick={() => {
                if (!window.confirm(`Take ${s.order.orderNumber} off this trip?`)) return;
                run(async () => {
                  await send(`/api/trips/${tripId}/orders?orderId=${encodeURIComponent(s.orderId)}`, "DELETE");
                  return `${s.order.orderNumber} taken off the trip.`;
                });
              }}
            >
              <Icon name="trash" className="h-4 w-4" /> Remove
            </button>
          )}
        </div>
      )}

      {failing && <NotDelivered s={s} onCancel={() => setFailing(false)} run={run} />}
    </div>
  );
}

function NotDelivered({ s, onCancel, run }: { s: StopJson; onCancel: () => void; run: (fn: () => Promise<string | undefined>) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!reason) return setError("Pick a reason");
    if (reason === "other" && !note.trim()) return setError("Write what happened");
    setBusy(true);
    setError(null);
    try {
      await send(`/api/orders/${s.orderId}/not-delivered`, "POST", { reason, note: note.trim() || undefined });
      await run(async () => `${s.order.orderNumber} marked not delivered. It is back in Ready to go.`);
    } catch (e) {
      setError(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 ml-11 rounded-2xl border border-[var(--line)] bg-white p-3 space-y-2.5">
      <p className="text-sm font-semibold">Why wasn&apos;t it delivered?</p>
      <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label="Reason">
        {Object.entries(FAIL_REASONS).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={reason === k}
            onClick={() => setReason(k)}
            className={`min-h-[44px] rounded-xl border px-3 text-left text-sm transition ${
              reason === k ? "border-mor bg-[var(--mint-tint)] font-semibold" : "border-[var(--line)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="block text-xs font-medium text-[var(--ink-2)] mb-1">Note{reason === "other" ? "" : " (optional)"}</span>
        <input className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      <div className="flex flex-wrap gap-2 justify-end">
        <button type="button" className="btn btn-quiet btn-sm !min-h-[44px]" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Mark not delivered"}
        </button>
      </div>
    </div>
  );
}
