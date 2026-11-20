"use client";

import { use, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import { formatINR } from "@/lib/money";
import { ErrorBox, errText, send, useFetch } from "@/components/admin/AdminKit";
import ReadyOrders from "@/components/dispatch/ReadyOrders";
import NewTripSheet from "@/components/dispatch/NewTripSheet";
import { ShortList, stockShortOf, type StockShort } from "@/components/dispatch/VanLoad";
import { StatusChip, addDays, dayLabel, plural, timeLabel, vehicleText, type Board, type BoardTrip } from "@/components/dispatch/kit";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export default function DispatchPage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const { date: initial } = use(searchParams);
  const [date, setDate] = useState<string | null>(typeof initial === "string" && YMD.test(initial) ? initial : null);
  const { data, error, reload } = useFetch<Board>(`/api/trips${date ? `?date=${date}` : ""}`);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newTrip, setNewTrip] = useState(false);
  const [flash, setFlash] = useState<{ text: string; href?: string; link?: string } | null>(null);

  const board = data && (!date || data.date === date) ? data : null;

  function goTo(d: string) {
    setDate(d);
    setSelected(new Set());
    setFlash(null);
    try {
      window.history.replaceState(null, "", `/admin/dispatch?date=${d}`);
    } catch {
      /* address bar only */
    }
  }

  const current = board?.date ?? date;

  return (
    <div className="space-y-5 pb-28">
      <div className="page-head">
        <div className="min-w-0">
          <p className="page-kick">Delivery</p>
          <h1 className="page-title">Dispatch</h1>
          <p className="page-sub">Plan the day&apos;s trips, load orders and send them out.</p>
        </div>
        <Link href="/admin/dispatch/vehicles" className="btn btn-quiet btn-sm">
          <Icon name="truck" className="h-4 w-4" /> Vehicles
        </Link>
      </div>

      <DayPicker
        date={current}
        today={board?.today ?? null}
        onChange={goTo}
      />

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!board && !error && <p className="text-sm text-[var(--muted)]">Loading…</p>}

      {flash && (
        <p className="card p-3 text-sm font-semibold text-[var(--mint-text)] bg-[var(--mint-tint)] flex flex-wrap items-center gap-2" role="status">
          <Icon name="check" className="h-4 w-4 shrink-0" />
          <span className="min-w-0">{flash.text}</span>
          {flash.href && (
            <Link href={flash.href} className="font-bold text-[var(--kesar-text)]">
              {flash.link ?? "Open trip →"}
            </Link>
          )}
        </p>
      )}

      {board && (
        <>
          <Trips board={board} onNew={() => setNewTrip(true)} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-heading font-bold text-xl">Ready to go</h2>
                <p className="text-sm text-[var(--muted)]">Due on or before this day and not on an open trip.</p>
              </div>
              {board.ready.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[var(--muted)]">{plural(board.ready.length, "order")}</span>
                  <PlanTrips board={board} onPlanned={(text) => setFlash({ text, href: "/admin/suggestions", link: "Review the plan →" })} />
                </div>
              )}
            </div>
            <ReadyOrders orders={board.ready} date={board.date} selected={selected} onChange={setSelected} />
          </section>

          {selected.size > 0 && (
            <AddBar
              board={board}
              selected={selected}
              onClear={() => setSelected(new Set())}
              onNew={() => setNewTrip(true)}
              onAdded={(text, href) => {
                setSelected(new Set());
                setFlash({ text, href });
                reload();
              }}
            />
          )}

          {newTrip && (
            <NewTripSheet
              board={board}
              selectedIds={[...selected]}
              onClose={() => setNewTrip(false)}
              onMade={(trip, withOrders) => {
                setNewTrip(false);
                if (withOrders) setSelected(new Set());
                setFlash({ text: `Trip ${trip.number} made.`, href: `/admin/dispatch/${trip.id}` });
                reload();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────── trip plan (A5) ─────────────────────────────

/** Splits the ready orders across the free drivers and opens the plan in Suggestions to accept. */
function PlanTrips({ board, onPlanned }: { board: Board; onPlanned: (text: string) => void }) {
  const [slot, setSlot] = useState(board.slots[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function plan() {
    setBusy(true);
    setErr(null);
    try {
      const r = await send<{ suggestion: { title: string } | null }>("/api/admin/trip-plan", "POST", { date: board.date, slot });
      onPlanned(r.suggestion ? `Trip plan ready: ${r.suggestion.title}.` : "Trip plan ready.");
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {board.slots.length > 1 && (
        <select className="input !w-auto !py-1.5 text-sm" value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Slot to plan">
          {board.slots.map((x) => (
            <option key={x.key} value={x.key}>
              {x.label}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={plan}>
        <Icon name="route" className="h-4 w-4" /> Plan trips
      </button>
      {err && (
        <span className="w-full text-sm text-[#a8281e]" role="alert">
          {err}
        </span>
      )}
    </>
  );
}

// ───────────────────────────── day picker ─────────────────────────────

function DayPicker({ date, today, onChange }: { date: string | null; today: string | null; onChange: (d: string) => void }) {
  return (
    <div className="card p-3 flex flex-wrap items-center gap-2 sm:max-w-md">
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 !min-h-[44px] shrink-0"
          aria-label="Previous day"
          disabled={!date}
          onClick={() => date && onChange(addDays(date, -1))}
        >
          <Icon name="chevronLeft" className="h-4 w-4" />
        </button>
        <input
          className="input min-w-0 flex-1"
          type="date"
          aria-label="Day"
          value={date ?? ""}
          onChange={(e) => YMD.test(e.target.value) && onChange(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-quiet btn-sm !px-3 !min-h-[44px] shrink-0"
          aria-label="Next day"
          disabled={!date}
          onClick={() => date && onChange(addDays(date, 1))}
        >
          <Icon name="chevronRight" className="h-4 w-4" />
        </button>
      </div>
      {date && today && date !== today && (
        <button type="button" className="btn btn-quiet btn-xs" onClick={() => onChange(today)}>
          Today
        </button>
      )}
      {date && <p className="w-full text-xs text-[var(--muted)]">{date === today ? `Today, ${dayLabel(date)}` : dayLabel(date)}</p>}
    </div>
  );
}

// ───────────────────────────── trips ─────────────────────────────

function Trips({ board, onNew }: { board: Board; onNew: () => void }) {
  const groups = board.slots.map((s) => ({ key: s.key, label: s.label, trips: board.trips.filter((t) => t.slot === s.key) }));
  const known = new Set(board.slots.map((s) => s.key));
  for (const t of board.trips) {
    if (known.has(t.slot)) continue;
    known.add(t.slot);
    groups.push({ key: t.slot, label: t.slot, trips: board.trips.filter((x) => x.slot === t.slot) });
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading font-bold text-xl">Trips</h2>
        <button type="button" className="btn btn-kesar btn-sm !min-h-[44px]" onClick={onNew}>
          <Icon name="plus" className="h-4 w-4" /> New trip
        </button>
      </div>
      {board.trips.length === 0 ? (
        <div className="card p-6 text-center space-y-1">
          <p className="text-sm font-semibold">No trips on this day yet</p>
          <p className="text-sm text-[var(--muted)]">Tick orders below, then make a trip for a driver and slot.</p>
        </div>
      ) : (
        groups
          .filter((g) => g.trips.length > 0)
          .map((g) => (
            <div key={g.key} className="space-y-2">
              <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--ink-2)]">{g.label}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.trips.map((t) => (
                  <TripCard key={t.id} t={t} />
                ))}
              </div>
            </div>
          ))
      )}
    </section>
  );
}

function TripCard({ t }: { t: BoardTrip }) {
  const open = t.stops - t.delivered - t.failed;
  return (
    <Link href={`/admin/dispatch/${t.id}`} className="card p-4 block hover:shadow-lg transition min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-heading font-bold break-all">{t.number}</p>
          <p className="text-sm truncate">{t.driver.name}</p>
          <p className="text-xs text-[var(--muted)] truncate">{vehicleText(t.vehicle)}</p>
        </div>
        <StatusChip status={t.status} small />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <Stat n={t.stops} label="Stops" />
        <Stat n={t.delivered} label="Delivered" tone="text-[var(--mint-text)]" />
        <Stat n={t.failed} label="Not delivered" tone={t.failed ? "text-[#a8281e]" : ""} />
        <Stat n={open} label="Open" />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold">{formatINR(t.value)}</span>
        <span className="text-xs text-[var(--muted)]">
          {t.closedAt ? `Closed ${timeLabel(t.closedAt)}` : t.startedAt ? `Left ${timeLabel(t.startedAt)}` : "Not left yet"}
        </span>
      </div>
      {t.note && <p className="mt-2 text-xs text-[var(--ink-2)] line-clamp-2">{t.note}</p>}
    </Link>
  );
}

function Stat({ n, label, tone = "" }: { n: number; label: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-ink/5 py-2 px-1 min-w-0">
      <p className={`font-heading font-bold text-lg leading-none ${tone}`}>{n}</p>
      <p className="text-[10.5px] text-[var(--muted)] mt-1 leading-tight">{label}</p>
    </div>
  );
}

// ───────────────────────────── add to trip ─────────────────────────────

function AddBar({
  board,
  selected,
  onClear,
  onNew,
  onAdded,
}: {
  board: Board;
  selected: Set<string>;
  onClear: () => void;
  onNew: () => void;
  onAdded: (text: string, href: string) => void;
}) {
  const open = board.trips.filter((t) => t.status !== "CLOSED");
  const [tripId, setTripId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = open.find((t) => t.id === tripId) ?? (open.length === 1 ? open[0] : null);
  const value = board.ready.filter((o) => selected.has(o.id)).reduce((s, o) => s + o.total, 0);

  const [short, setShort] = useState<StockShort[] | null>(null);

  async function add(stockOverride = false) {
    if (!target) return setError("Pick a trip");
    setBusy(true);
    setError(null);
    setShort(null);
    try {
      await send(`/api/trips/${target.id}/orders`, "POST", { orderIds: [...selected], ...(stockOverride ? { stockOverride: true } : {}) });
      onAdded(
        `${plural(selected.size, "order")} added to ${target.number}${target.status === "STARTED" ? " and sent out for delivery" : ""}.`,
        `/admin/dispatch/${target.id}`
      );
    } catch (e) {
      const s = stockShortOf(e);
      if (s) setShort(s);
      else setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sticky bottom-[5.5rem] md:bottom-3 z-10">
      <div className="card p-3 space-y-2 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">
            {plural(selected.size, "order")} selected · {formatINR(value)}
          </p>
          <button type="button" className="btn btn-quiet btn-xs" onClick={onClear}>
            Clear
          </button>
        </div>
        {open.length > 0 ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <select className="input sm:flex-1 min-w-0" aria-label="Trip to add to" value={target?.id ?? ""} onChange={(e) => setTripId(e.target.value)}>
              {open.length > 1 && <option value="">Pick a trip</option>}
              {open.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.number} · {t.driver.name} · {board.slots.find((s) => s.key === t.slot)?.label ?? t.slot}
                  {t.status === "STARTED" ? " (on the road)" : ""}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <button type="button" className="btn btn-kesar flex-1 sm:flex-none" disabled={busy || !target} onClick={() => add()}>
                {busy ? "Adding…" : "Add to trip"}
              </button>
              <button type="button" className="btn btn-outline flex-1 sm:flex-none" disabled={busy} onClick={onNew}>
                New trip
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-kesar w-full" onClick={onNew}>
            <Icon name="plus" className="h-4 w-4" /> New trip with these
          </button>
        )}
        {target?.status === "STARTED" && <p className="text-xs text-[var(--muted)]">This trip has left: the orders go out for delivery at once.</p>}
        {short && (
          <div className="space-y-2 rounded-2xl bg-[var(--genda-tint)] p-3">
            <ShortList rows={short} />
            <button type="button" className="btn btn-kesar btn-sm !min-h-[44px] w-full" disabled={busy} onClick={() => add(true)}>
              Add anyway (the goods are there)
            </button>
          </div>
        )}
        {error && <p className="text-sm text-[#a8281e]">{error}</p>}
      </div>
    </div>
  );
}
