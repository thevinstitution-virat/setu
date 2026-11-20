import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney } from "@/lib/ledger";
import { stockOn, vanStock } from "@/lib/stock";
import { tripDay } from "@/lib/trips";

/**
 * The driver's van stock: their running trip's van, else today's planned
 * trip's van. Per product: on hand, held for open stops, free to spot-sell,
 * batches. enabled=false when the business doesn't track stock.
 */
export async function GET() {
  const auth = await guard("delivery.work");
  if (!auth.ok) return auth.res;
  const agent = await auth.db.deliveryAgentProfile.findUnique({ where: { userId: auth.session.userId } });
  if (!agent) return NextResponse.json({ enabled: false, trip: null, rows: [] });
  const out = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
    if (!(await stockOn(ctx))) return { enabled: false, trip: null, rows: [] };
    const trip =
      (await ctx.tx.trip.findFirst({ where: { driverId: agent.id, status: "STARTED" }, orderBy: { startedAt: "desc" }, include: { vehicle: { select: { id: true, number: true } } } })) ??
      (await ctx.tx.trip.findFirst({ where: { driverId: agent.id, status: "PLANNED", date: tripDay() }, orderBy: { createdAt: "asc" }, include: { vehicle: { select: { id: true, number: true } } } }));
    if (!trip?.vehicle) return { enabled: true, trip: trip ? { id: trip.id, number: trip.number, status: trip.status, vehicle: null } : null, rows: [] };
    const van = await vanStock(ctx, trip.vehicle.id);
    return {
      enabled: true,
      trip: { id: trip.id, number: trip.number, status: trip.status, vehicle: trip.vehicle },
      canSell: trip.status === "STARTED",
      rows: van.rows.map((r) => ({ ...r, lots: r.lots.map((l) => ({ ...l, expiry: l.expiry ? l.expiry.toISOString().slice(0, 10) : null })) })),
    };
  });
  return NextResponse.json(out);
}
