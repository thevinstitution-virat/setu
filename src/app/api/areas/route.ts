import { NextResponse } from "next/server";
import { getDb } from "@/lib/tenant";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

export async function GET() {
  const db = await getDb();
  const regions = await db.region.findMany({
    include: { areas: { orderBy: { name: "asc" } } },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ regions });
}

export async function POST(req: Request) {
  const auth = await guard("areas.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const body = await req.json().catch(() => null);
  const { name, regionId } = body ?? {};
  if (!name || !regionId) {
    return NextResponse.json({ error: "name and regionId are required" }, { status: 400 });
  }
  const area = await db.area.create({ data: { name, regionId } });
  await audit(db, { actorId: session.userId, action: "area.create", entity: "Area", entityId: area.id, after: area, ip: requestIp(req) });
  return NextResponse.json({ area });
}
