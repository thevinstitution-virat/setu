import Link from "next/link";
import { formatINR } from "@/lib/money";
import { directionsUrl, type TripStop } from "@/lib/trip-api";
import Icon from "@/components/Icon";
import StopCard, { PlannedStopRow } from "./StopCard";
import { SortStopsButton, StartTripButton } from "./TripActions";

export type DriverTrip = {
  id: string;
  number: string;
  slotLabel: string;
  vehicle: string | null;
  status: "PLANNED" | "STARTED" | "CLOSED";
  stops: TripStop[];
  /** Cash collected at this trip's stops so far (paise). */
  cash: number;
};

const STATUS = {
  PLANNED: { label: "Not started", cls: "chip-genda" },
  STARTED: { label: "On the road", cls: "chip-kesar" },
  CLOSED: { label: "Closed", cls: "" },
} as const;

function TripHead({ trip }: { trip: DriverTrip }) {
  const s = STATUS[trip.status];
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-heading font-bold text-lg leading-tight break-all">{trip.number}</p>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          {trip.slotLabel}
          {trip.vehicle ? ` · ${trip.vehicle}` : ""}
        </p>
      </div>
      <span className={`chip shrink-0 ${s.cls}`}>{s.label}</span>
    </div>
  );
}

function Progress({ stops }: { stops: TripStop[] }) {
  const done = stops.filter((s) => s.state === "DELIVERED").length;
  const failed = stops.filter((s) => s.state === "FAILED").length;
  const pct = stops.length ? Math.round(((done + failed) / stops.length) * 100) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="font-semibold">
          {done} of {stops.length} delivered
        </span>
        {failed > 0 && <span className="text-[#a8281e] font-semibold">{failed} not delivered</span>}
      </div>
      <div className="h-2 rounded-full bg-black/[0.07] overflow-hidden">
        <div className="h-full rounded-full bg-[var(--mint)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Van stock (and Spot sale while running), only when stock is tracked and the trip has a van. */
function VanLinks({ sell }: { sell: boolean }) {
  return (
    <div className={`grid gap-2 ${sell ? "grid-cols-2" : "grid-cols-1"}`}>
      <Link href="/delivery/van" className="btn btn-outline">
        <Icon name="stock" className="h-4 w-4" /> Van stock
      </Link>
      {sell && (
        <Link href="/delivery/spot-sale" className="btn btn-soft">
          <Icon name="cart" className="h-4 w-4" /> Spot sale
        </Link>
      )}
    </div>
  );
}

/** A trip that hasn't left: its stops and the big Start button. */
function PlannedTrip({ trip, stock }: { trip: DriverTrip; stock: boolean }) {
  return (
    <section className="card p-4 space-y-4">
      <TripHead trip={trip} />
      <ul className="divide-y divide-[var(--line)]">
        {trip.stops.map((s) => (
          <PlannedStopRow key={s.orderId} stop={s} />
        ))}
      </ul>
      {trip.stops.length > 1 && <SortStopsButton tripId={trip.id} />}
      {stock && trip.vehicle && <VanLinks sell={false} />}
      {trip.stops.length > 0 ? (
        <StartTripButton tripId={trip.id} stops={trip.stops.length} />
      ) : (
        <p className="text-sm text-[var(--muted)]">No orders on this trip yet. The office will add them.</p>
      )}
    </section>
  );
}

/** A running trip: progress, route, then one card per stop in route order. */
function RunningTrip({ trip, stock }: { trip: DriverTrip; stock: boolean }) {
  const open = trip.stops.filter((s) => s.state === "ASSIGNED");
  const route = directionsUrl(open.map((s) => s.retailer));
  return (
    <section className="space-y-3">
      <div className="card p-4 space-y-4">
        <TripHead trip={trip} />
        <Progress stops={trip.stops} />
        {open.length > 0 && (
          <div className="grid grid-cols-2 gap-2 items-start">
            {route ? (
              <a href={route} target="_blank" rel="noopener noreferrer" className="btn btn-mor">
                <Icon name="map" className="h-4 w-4" /> Route in Maps
              </a>
            ) : (
              <span />
            )}
            {open.length > 1 ? <SortStopsButton tripId={trip.id} /> : <span />}
          </div>
        )}
        {open.length === 0 && (
          <p className="flex items-center gap-2 rounded-xl bg-[var(--mint-tint)] text-[var(--mint-text)] p-3 text-sm font-bold">
            <Icon name="check" className="h-4 w-4" /> All stops done.
            {trip.cash > 0 ? ` Hand over ${formatINR(trip.cash)} cash at the office.` : ""}
          </p>
        )}
        {stock && trip.vehicle && <VanLinks sell={trip.status === "STARTED"} />}
      </div>
      {trip.stops.map((s) => (
        <StopCard key={s.orderId} stop={s} />
      ))}
    </section>
  );
}

/** `stock`: the business tracks stock (van stock and spot sales are shown for trips with a van). */
export default function TripCard({ trip, stock = false }: { trip: DriverTrip; stock?: boolean }) {
  return trip.status === "PLANNED" ? <PlannedTrip trip={trip} stock={stock} /> : <RunningTrip trip={trip} stock={stock} />;
}

/** A closed trip of today, kept short and grey. */
export function ClosedTripRow({ trip }: { trip: DriverTrip }) {
  const done = trip.stops.filter((s) => s.state === "DELIVERED").length;
  const failed = trip.stops.filter((s) => s.state === "FAILED").length;
  return (
    <div className="card p-3 flex items-center gap-3 opacity-70">
      <span className="icon-tile bg-black/[0.06] text-[var(--muted)]">
        <Icon name="check" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm break-all">{trip.number}</p>
        <p className="text-xs text-[var(--muted)]">
          {trip.slotLabel} · {done} of {trip.stops.length} delivered
          {failed > 0 ? ` · ${failed} not delivered` : ""}
        </p>
      </div>
    </div>
  );
}
