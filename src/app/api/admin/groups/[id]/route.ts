import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { bad, idArray, optText, ownIds, text } from "@/lib/catalogue-api";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const group = await auth.db.retailerGroup.findUnique({
    where: { id },
    include: { members: { select: { retailer: { select: { id: true, outletName: true, area: { select: { name: true } } } } } } },
  });
  if (!group) return bad("Not found", 404);
  return NextResponse.json({ group: { ...group, members: group.members.map((m) => m.retailer) } });
}

/** { name?, description?, add?: retailerIds, remove?: retailerIds } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const before = await db.retailerGroup.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const b = (await req.json().catch(() => null)) ?? {};
  const data: Record<string, unknown> = {};
  if ("name" in b) {
    const name = text(b.name, 60);
    if (!name) return bad("Name is required");
    if (await db.retailerGroup.findFirst({ where: { id: { not: id }, name: { equals: name, mode: "insensitive" } } })) return bad("That group already exists", 409);
    data.name = name;
  }
  if ("description" in b) data.description = optText(b.description, 200);
  const add = idArray(b.add ?? [], 5000);
  const remove = idArray(b.remove ?? [], 5000);
  if (!add || !remove || !(await ownIds(db, "retailer", add))) return bad("Unknown retailer");
  await withTenantTx(tenant.id, async (tx) => {
    if (Object.keys(data).length) await tx.retailerGroup.update({ where: { id }, data });
    if (add.length) await tx.retailerGroupMember.createMany({ data: add.map((retailerId) => ({ groupId: id, retailerId })), skipDuplicates: true });
    if (remove.length) await tx.retailerGroupMember.deleteMany({ where: { groupId: id, retailerId: { in: remove } } });
  });
  await audit(db, { actorId: session.userId, action: "group.update", entity: "RetailerGroup", entityId: id, before, after: { ...data, added: add.length, removed: remove.length }, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const { id } = await params;
  const before = await db.retailerGroup.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const inUse =
    (await db.scheme.count({ where: { groupIds: { has: id }, active: true } })) +
    (await db.product.count({ where: { visibleGroupIds: { has: id } } })) +
    (await db.banner.count({ where: { groupIds: { has: id }, active: true } }));
  if (inUse) return bad("Schemes, banners or product visibility still use this group. Remove it there first.", 409);
  await db.retailerGroup.delete({ where: { id } });
  await audit(db, { actorId: session.userId, action: "group.delete", entity: "RetailerGroup", entityId: id, before, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
