import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, parseBanner } from "@/lib/catalogue-api";

export async function GET() {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const banners = await auth.db.banner.findMany({ orderBy: [{ active: "desc" }, { sort: "asc" }, { createdAt: "desc" }] });
  return NextResponse.json({ banners });
}

export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const data = await parseBanner(db, tenant.id, (await req.json().catch(() => null)) ?? {}, false);
  if (typeof data === "string") return bad(data);
  const banner = await db.banner.create({ data: data as never });
  await audit(db, { actorId: session.userId, action: "banner.create", entity: "Banner", entityId: banner.id, after: banner, ip: requestIp(req) });
  return NextResponse.json({ banner });
}
