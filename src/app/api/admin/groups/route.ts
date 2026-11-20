import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, idArray, optText, ownIds, text } from "@/lib/catalogue-api";

export async function GET() {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const groups = await auth.db.retailerGroup.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } });
  return NextResponse.json({ groups });
}

/** { name, description?, retailerIds? } */
export async function POST(req: Request) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const b = (await req.json().catch(() => null)) ?? {};
  const name = text(b.name, 60);
  if (!name) return bad("Name is required");
  if (await db.retailerGroup.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) return bad("That group already exists", 409);
  const ids = idArray(b.retailerIds ?? [], 5000);
  if (!ids || !(await ownIds(db, "retailer", ids))) return bad("Unknown retailer");
  const group = await db.retailerGroup.create({
    data: { name, description: optText(b.description, 200), members: { create: ids.map((retailerId) => ({ retailerId })) } },
  });
  await audit(db, { actorId: session.userId, action: "group.create", entity: "RetailerGroup", entityId: group.id, after: { ...group, members: ids.length }, ip: requestIp(req) });
  return NextResponse.json({ group });
}
