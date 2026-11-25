import { formatINR } from "@/lib/money";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb, requireTenant } from "@/lib/tenant";
import { withMoney } from "@/lib/ledger";
import { tripDay, tripSummary } from "@/lib/trips";
import { tripStops } from "@/lib/trip-api";
import { deliverySettings, slotLabel } from "@/lib/delivery-settings";
import { inventorySettings } from "@/lib/inventory-settings";
import Icon from "@/components/Icon";
import EmptyState from "@/components/ui/EmptyState";
import WorkspaceSwitcher from "@/components/field/WorkspaceSwitcher";
import AnnouncementCards from "@/components/engage/AnnouncementCards";
import DutySwitch from "./DutySwitch";
import TripCard, { ClosedTripRow, type DriverTrip } from "./TripCard";

const ORDER = { STARTED: 0, PLANNED: 1, CLOSED: 2 } as const;

/**
 * Driver home: duty switch, today's trips (running first, then not started,
 * closed ones folded away) and orders assigned without a trip (old flow).
 */
export default async function DeliveryHome() {
  const [db, session, tenant] = await Promise.all([getDb(), getSession(), requireTenant()]);
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session!.userId }, select: { id: true } });

  if (!agent) {
    return (
      <div className="space-y-6">
        <h1 className="page-title">Deliveries</h1>
        <div className="card p-6 text-center text-sm text-[var(--ink-2)]">
          Your driver profile isn&apos;t set up yet. Ask the office to add you as a driver.
        </div>
      </div>
    );
  }

  const [shift, rows, loose] = await Promise.all([
    db.dutyShift.findFirst({ where: { userId: session!.userId, endAt: null }, orderBy: { startAt: "desc" } }),
    db.trip.findMany({
      where: { driverId: agent.id, OR: [{ date: tripDay() }, { status: "STARTED" }] },
      include: { vehicle: { select: { number: true, name: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
    db.delivery.findMany({
      where: { deliveryAgentId: agent.id, tripId: null, order: { status: "OUT_FOR_DELIVERY" } },
      include: { order: { include: { retailer: true, items: { select: { id: true } } } } },
      orderBy: { assignedAt: "asc" },
    }),
  ]);

  const settings = deliverySettings(tenant.settings);
  const trips: DriverTrip[] = await Promise.all(
    rows.map(async (t) => ({
      id: t.id,
      number: t.number,
      slotLabel: slotLabel(settings, t.slot),
      vehicle: t.vehicle ? [t.vehicle.number, t.vehicle.name].filter(Boolean).join(" · ") : null,
      status: t.status,
      stops: await tripStops(db, t.id),
      cash:
        t.status === "STARTED"
          ? ((await withMoney(tenant.id, null, (ctx) => tripSummary(ctx, t.id))).collected.CASH ?? 0)
          : 0,
    }))
  );
  trips.sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const active = trips.filter((t) => t.status !== "CLOSED");
  const closed = trips.filter((t) => t.status === "CLOSED");

  const dropsLeft =
    active.reduce((n, t) => n + t.stops.filter((s) => s.state === "ASSIGNED").length, 0) + loose.length;
  const cash = trips.filter((t) => t.status === "STARTED").reduce((n, t) => n + t.cash, 0);
  const running = trips.some((t) => t.status === "STARTED");
  // Stock tracked: trips with a van get "Van stock" (and "Spot sale" while running).
  const stock = inventorySettings(tenant.settings).enabled;

  return (
    <div className="space-y-6">
      <div>
        <p className="page-kick">On the road</p>
        <h1 className="page-title">Today&apos;s deliveries</h1>
      </div>

      <WorkspaceSwitcher />

      <DutySwitch
        key={`${!!shift}-${shift?.startAt.toISOString() ?? ""}`}
        onDuty={!!shift}
        since={shift?.startAt.toISOString() ?? null}
      />

      <AnnouncementCards />

      <div className="panel-dark p-5 grid grid-cols-2 gap-4" data-ground="dark">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Drops left</p>
          <p className="stat-num mt-2">{dropsLeft}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-genda">Cash collected</p>
          <p className="stat-num mt-2 num">{formatINR(cash, { whole: true })}</p>
          <p className="text-xs text-white/60 mt-1">{running ? "On this trip" : "No trip running"}</p>
        </div>
      </div>

      {active.map((t) => (
        <TripCard key={t.id} trip={t} stock={stock} />
      ))}

      {loose.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-bold text-base">{trips.length ? "Other assigned orders" : "Assigned orders"}</h2>
          {loose.map((d, i) => (
            <Link
              key={d.id}
              href={`/delivery/orders/${d.order.id}`}
              className="card p-4 flex items-center gap-3 min-h-[64px] hover:-translate-y-0.5 transition"
            >
              <span className="icon-tile bg-[var(--accent-tint)] text-[var(--accent-text)] font-heading font-bold">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{d.order.retailer.outletName}</p>
                <p className="text-xs text-[var(--muted)] truncate">
                  {d.order.orderNumber} · {d.order.items.length} items · {formatINR(d.order.totalAmount)}
                </p>
              </div>
              <span className="btn btn-kesar btn-sm shrink-0">
                Deliver <Icon name="arrow" className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </section>
      )}

      {closed.length > 0 && (
        <details className="group space-y-3">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-3 min-h-[44px] text-sm font-semibold text-[var(--muted)]">
            <span>Finished today ({closed.length})</span>
            <Icon name="chevronRight" className="h-4 w-4 transition group-open:rotate-90" />
          </summary>
          <div className="space-y-2">
            {closed.map((t) => (
              <ClosedTripRow key={t.id} trip={t} />
            ))}
          </div>
        </details>
      )}

      {active.length === 0 && loose.length === 0 && (
        <div className="card">
          <EmptyState icon={closed.length ? "success-tick" : "van"} title={closed.length ? "All done for today" : "No deliveries right now"} text={closed.length ? "Today's trips are finished." : "Orders assigned to you will show up here."} />
        </div>
      )}
    </div>
  );
}
