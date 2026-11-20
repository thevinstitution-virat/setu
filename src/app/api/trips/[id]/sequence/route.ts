import { NextResponse } from "next/server";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { autoSequence, reorderStops } from "@/lib/trips";
import { tripAuth } from "@/lib/trip-api";

/**
 * Route order. Body: { auto: true } (nearest next stop from the warehouse,
 * then by area) or { orderIds: [...] } (every stop, in the new order).
 * Dispatch staff, or the driver on their own trip.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id, { driver: true });
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => null);
  let result: { located: number; total: number } | null = null;
  try {
    result = await withMoney(a.tenant.id, a.session.userId, async (ctx) => {
      if (body?.auto === true) return autoSequence(ctx, id);
      await reorderStops(ctx, id, Array.isArray(body?.orderIds) ? body.orderIds.map(String) : []);
      return null;
    });
  } catch (e) {
    return moneyFail(e);
  }
  await audit(a.db, { actorId: a.session.userId, action: "trip.sequence", entity: "Trip", entityId: id, after: body?.auto ? { auto: true } : { orderIds: body?.orderIds }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, ...(result ?? {}) });
}
