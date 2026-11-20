import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { normalisePlate } from "@/lib/trip-api";

/** Vehicles (all, inactive last). */
export async function GET() {
  const auth = await guard("orders.dispatch");
  if (!auth.ok) return auth.res;
  const vehicles = await auth.db.vehicle.findMany({ orderBy: [{ active: "desc" }, { number: "asc" }] });
  return NextResponse.json({ vehicles });
}

/** Body: { number, name?, capacityKg? } */
export async function POST(req: Request) {
  const auth = await guard("orders.dispatch");
  if (!auth.ok) return auth.res;
  const body = await req.json().catch(() => null);
  const number = normalisePlate(body?.number);
  if (number.length < 4) return NextResponse.json({ error: "Enter the vehicle number, like MH12AB1234" }, { status: 400 });
  const cap = body?.capacityKg === null || body?.capacityKg === undefined || body?.capacityKg === "" ? null : Number(body.capacityKg);
  if (cap !== null && (!Number.isInteger(cap) || cap < 1 || cap > 100_000)) return NextResponse.json({ error: "Capacity must be a whole number of kg" }, { status: 400 });
  const exists = await auth.db.vehicle.findFirst({ where: { number } });
  if (exists) return NextResponse.json({ error: "That vehicle is already added" }, { status: 409 });
  const vehicle = await auth.db.vehicle.create({ data: { number, name: String(body?.name ?? "").trim().slice(0, 40) || null, capacityKg: cap } });
  await audit(auth.db, { actorId: auth.session.userId, action: "vehicle.create", entity: "Vehicle", entityId: vehicle.id, after: vehicle, ip: requestIp(req) });
  return NextResponse.json({ vehicle }, { status: 201 });
}
