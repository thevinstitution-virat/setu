import { NextResponse } from "next/server";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { closeTrip } from "@/lib/trips";
import { tripAuth } from "@/lib/trip-api";

/**
 * Day close: freezes load vs delivered vs returned vs cash for the trip.
 * Body: { force?: true } closes even with open stops (they become "not
 * delivered — ran out of time" and go back to Packed). Office only; the
 * driver's cash is received separately (Cash → handover).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id);
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => null);
  let summary;
  try {
    summary = await withMoney(a.tenant.id, a.session.userId, (ctx) => closeTrip(ctx, id, { force: body?.force === true }));
  } catch (e) {
    return moneyFail(e);
  }
  await audit(a.db, { actorId: a.session.userId, action: "trip.close", entity: "Trip", entityId: id, after: summary as unknown as Record<string, unknown>, ip: requestIp(req) });
  return NextResponse.json({ summary });
}
