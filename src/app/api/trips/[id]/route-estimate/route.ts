import { NextResponse } from "next/server";
import { tripAuth } from "@/lib/trip-api";
import { asPlatform } from "@/lib/db";
import { deliverySettings } from "@/lib/delivery-settings";
import { estimateRoute } from "@/lib/maps";

/**
 * Distance and time for the trip in its current order: from the warehouse (when
 * set) through every stop with a map pin. Road figures with a maps provider,
 * else straight line × 1.3 at 20 km/h. Stops without a pin are counted, not routed.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id, { driver: true });
  if (!a.ok) return a.res;
  const stops = await a.db.delivery.findMany({
    where: { tripId: id },
    orderBy: { seq: "asc" },
    select: { orderId: true, state: true, order: { select: { retailer: { select: { lat: true, lng: true } } } } },
  });
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: a.tenant.id }, select: { settings: true } }));
  const depot = deliverySettings(t.settings).depot;
  const pinned = stops.filter((s) => s.order.retailer.lat !== null && s.order.retailer.lng !== null);
  const points = [...(depot ? [depot] : []), ...pinned.map((s) => ({ lat: s.order.retailer.lat!, lng: s.order.retailer.lng! }))];
  const est = await estimateRoute(a.tenant.id, points);
  const offset = depot ? 1 : 0;
  return NextResponse.json({
    ...est,
    fromDepot: !!depot,
    stops: pinned.map((s, i) => ({ orderId: s.orderId, state: s.state, ...(i + offset > 0 ? est.legs[i + offset - 1] : { km: 0, minutes: 0 }) })),
    unpinned: stops.length - pinned.length,
  });
}
