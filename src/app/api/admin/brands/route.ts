import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, optText, text } from "@/lib/catalogue-api";
import { keyBelongsTo } from "@/lib/storage";

export async function GET() {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const brands = await auth.db.brand.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });
  return NextResponse.json({ brands });
}

export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const b = (await req.json().catch(() => null)) ?? {};
  const name = text(b.name, 60);
  if (!name) return bad("Name is required");
  if (await db.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) return bad("That brand already exists", 409);
  const logoKey = optText(b.logoKey, 300);
  if (logoKey && !keyBelongsTo(logoKey, tenant.id)) return bad("Unknown logo");
  const brand = await db.brand.create({ data: { name, logoKey, sort: Number.isInteger(b.sort) ? b.sort : 0 } });
  await audit(db, { actorId: session.userId, action: "brand.create", entity: "Brand", entityId: brand.id, after: brand, ip: requestIp(req) });
  return NextResponse.json({ brand });
}
