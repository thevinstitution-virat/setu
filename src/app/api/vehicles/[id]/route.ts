import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { normalisePlate } from "@/lib/trip-api";

/** Body: { number?, name?, capacityKg?, active? } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("orders.dispatch");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const before = await auth.db.vehicle.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Vehicle not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) ?? {};
  const data: { number?: string; name?: string | null; capacityKg?: number | null; active?: boolean } = {};
  if ("number" in body) {
    const n = normalisePlate(body.number);
    if (n.length < 4) return NextResponse.json({ error: "Enter the vehicle number, like MH12AB1234" }, { status: 400 });
    const clash = await auth.db.vehicle.findFirst({ where: { number: n, NOT: { id } } });
    if (clash) return NextResponse.json({ error: "That vehicle is already added" }, { status: 409 });
    data.number = n;
  }
  if ("name" in body) data.name = String(body.name ?? "").trim().slice(0, 40) || null;
  if ("capacityKg" in body) {
    const cap = body.capacityKg === null || body.capacityKg === "" ? null : Number(body.capacityKg);
    if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 100_000)) return NextResponse.json({ error: "Capacity must be a whole number of kg" }, { status: 400 });
    data.capacityKg = cap;
  }
  if ("active" in body) data.active = body.active === true;
  const vehicle = await auth.db.vehicle.update({ where: { id }, data });
  await audit(auth.db, { actorId: auth.session.userId, action: "vehicle.update", entity: "Vehicle", entityId: id, before, after: vehicle, ip: requestIp(req) });
  return NextResponse.json({ vehicle });
}
