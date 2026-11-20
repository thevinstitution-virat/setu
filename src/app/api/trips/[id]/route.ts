import { NextResponse } from "next/server";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { tripSummary, updateTrip, type TripSummary } from "@/lib/trips";
import { directionsUrl, tripAuth, tripStops } from "@/lib/trip-api";
import { deliverySettings, slotLabel } from "@/lib/delivery-settings";

/**
 * One trip: header, stops in route order, load sheet and day-close figures
 * (live while open, frozen once closed). Dispatch staff, or the trip's driver.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id, { driver: true });
  if (!a.ok) return a.res;
  const { db, tenant, trip } = a;
  const [full, stops, summary] = await Promise.all([
    db.trip.findUniqueOrThrow({
      where: { id },
      include: { driver: { select: { id: true, user: { select: { name: true, phone: true } } } }, vehicle: { select: { id: true, number: true, name: true } } },
    }),
    tripStops(db, id),
    trip.status === "CLOSED" && trip.closeSummary
      ? Promise.resolve(trip.closeSummary as unknown as TripSummary)
      : withMoney(tenant.id, null, (ctx) => tripSummary(ctx, id)),
  ]);
  const open = stops.filter((s) => s.state === "ASSIGNED").map((s) => s.retailer);
  const settings = deliverySettings(tenant.settings);
  return NextResponse.json({
    trip: {
      id: full.id,
      number: full.number,
      date: full.date.toISOString().slice(0, 10),
      slot: full.slot,
      slotLabel: slotLabel(settings, full.slot),
      status: full.status,
      note: full.note,
      driver: { id: full.driver.id, name: full.driver.user.name, phone: full.driver.user.phone },
      vehicle: full.vehicle,
      startedAt: full.startedAt,
      closedAt: full.closedAt,
    },
    stops,
    summary,
    directions: directionsUrl(open),
    canManage: a.staff,
  });
}

/** Change driver, vehicle, day, slot (before it leaves) or note. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id);
  if (!a.ok) return a.res;
  const body = (await req.json().catch(() => null)) ?? {};
  const pick = (k: string) => (k in body ? (body[k] === null ? null : String(body[k])) : undefined);
  let trip;
  try {
    trip = await withMoney(a.tenant.id, a.session.userId, (ctx) =>
      updateTrip(ctx, id, {
        driverId: pick("driverId") ?? undefined,
        vehicleId: pick("vehicleId"),
        note: pick("note"),
        slot: pick("slot") ?? undefined,
        date: pick("date") ?? undefined,
      })
    );
  } catch (e) {
    return moneyFail(e);
  }
  await audit(a.db, {
    actorId: a.session.userId,
    action: "trip.update",
    entity: "Trip",
    entityId: id,
    before: { driverId: a.trip.driverId, vehicleId: a.trip.vehicleId, slot: a.trip.slot, date: a.trip.date, note: a.trip.note },
    after: body,
    ip: requestIp(req),
  });
  return NextResponse.json({ trip });
}
