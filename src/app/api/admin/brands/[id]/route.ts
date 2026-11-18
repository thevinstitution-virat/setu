import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, optText, text } from "@/lib/catalogue-api";
import { keyBelongsTo } from "@/lib/storage";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const before = await db.brand.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const b = (await req.json().catch(() => null)) ?? {};
  const data: Record<string, unknown> = {};
  if ("name" in b) {
    const name = text(b.name, 60);
    if (!name) return bad("Name is required");
    if (await db.brand.findFirst({ where: { id: { not: id }, name: { equals: name, mode: "insensitive" } } })) return bad("That brand already exists", 409);
    data.name = name;
  }
  if ("logoKey" in b) {
    const k = optText(b.logoKey, 300);
    if (k && !keyBelongsTo(k, tenant.id)) return bad("Unknown logo");
    data.logoKey = k;
  }
  if ("sort" in b) data.sort = Number.isInteger(b.sort) ? b.sort : 0;
  if ("active" in b) data.active = b.active === true;
  const brand = await db.brand.update({ where: { id }, data });
  await audit(db, { actorId: session.userId, action: "brand.update", entity: "Brand", entityId: id, before, after: brand, ip: requestIp(req) });
  return NextResponse.json({ brand });
}
