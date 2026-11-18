import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

export async function GET() {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { db } = auth;
  const regions = await db.region.findMany({
    include: { areas: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ regions });
}

export async function POST(req: Request) {
  const auth = await guard("areas.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const body = await req.json().catch(() => null);
  const { name } = body ?? {};
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  const region = await db.region.create({ data: { name } });
  await audit(db, { actorId: session.userId, action: "region.create", entity: "Region", entityId: region.id, after: region, ip: requestIp(req) });
  return NextResponse.json({ region });
}
