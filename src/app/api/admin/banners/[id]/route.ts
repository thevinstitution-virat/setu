import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, parseBanner } from "@/lib/catalogue-api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const before = await db.banner.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const data = await parseBanner(db, tenant.id, (await req.json().catch(() => null)) ?? {}, true);
  if (typeof data === "string") return bad(data);
  const banner = await db.banner.update({ where: { id }, data: data as never });
  await audit(db, { actorId: session.userId, action: "banner.update", entity: "Banner", entityId: id, before, after: banner, ip: requestIp(req) });
  return NextResponse.json({ banner });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const { id } = await params;
  const before = await db.banner.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  await db.banner.delete({ where: { id } });
  await audit(db, { actorId: session.userId, action: "banner.delete", entity: "Banner", entityId: id, before, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
