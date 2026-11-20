import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { checkIn } from "@/lib/field";

/**
 * Driver on / off duty. Location is taken when duty starts or ends, and in
 * between only when the business turned on location tracking (Settings ->
 * Field team); never off duty (DPDP: location on duty only).
 */
export async function GET() {
  const auth = await guard("delivery.work");
  if (!auth.ok) return auth.res;
  const shift = await auth.db.dutyShift.findFirst({ where: { userId: auth.session.userId, endAt: null }, orderBy: { startAt: "desc" } });
  return NextResponse.json({ onDuty: !!shift, since: shift?.startAt ?? null });
}

/** Body: { on: boolean, lat?, lng? } */
export async function POST(req: Request) {
  const auth = await guard("delivery.work");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const body = await req.json().catch(() => null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const lat = num(body?.lat);
  const lng = num(body?.lng);
  const open = await db.dutyShift.findFirst({ where: { userId: session.userId, endAt: null }, orderBy: { startAt: "desc" } });

  if (body?.on === true) {
    if (open) return NextResponse.json({ onDuty: true, since: open.startAt });
    const shift = await db.dutyShift.create({ data: { userId: session.userId, startLat: lat, startLng: lng } });
    // Going on duty marks the day present (no selfie asked; the day's check-out still needs one).
    await withMoney(auth.tenant.id, session.userId, (ctx) => checkIn(ctx, session.userId, { lat, lng }, { auto: true }));
    await audit(db, { actorId: session.userId, action: "duty.on", entity: "DutyShift", entityId: shift.id, ip: requestIp(req) });
    return NextResponse.json({ onDuty: true, since: shift.startAt });
  }
  if (!open) return NextResponse.json({ onDuty: false, since: null });
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
  const running = agent ? await db.trip.findFirst({ where: { driverId: agent.id, status: "STARTED" }, select: { number: true } }) : null;
  if (running) return NextResponse.json({ error: `Trip ${running.number} is still running. Finish your stops first.` }, { status: 409 });
  await db.dutyShift.update({ where: { id: open.id }, data: { endAt: new Date(), endLat: lat, endLng: lng } });
  await audit(db, { actorId: session.userId, action: "duty.off", entity: "DutyShift", entityId: open.id, ip: requestIp(req) });
  return NextResponse.json({ onDuty: false, since: null });
}
