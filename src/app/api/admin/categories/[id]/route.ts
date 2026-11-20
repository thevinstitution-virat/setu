import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, optText, ownIds, text } from "@/lib/catalogue-api";
import { keyBelongsTo } from "@/lib/storage";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const before = await db.category.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const b = (await req.json().catch(() => null)) ?? {};
  const data: Record<string, unknown> = {};
  if ("name" in b) {
    const name = text(b.name, 60);
    if (!name) return bad("Name is required");
    if (await db.category.findFirst({ where: { id: { not: id }, name: { equals: name, mode: "insensitive" } } })) return bad("That category already exists", 409);
    data.name = name;
  }
  if ("parentId" in b) {
    const parentId = typeof b.parentId === "string" && b.parentId ? b.parentId : null;
    if (parentId) {
      if (!(await ownIds(db, "category", [parentId]))) return bad("Unknown parent category");
      // No loops: the new parent can't be this category or one under it.
      const all = await db.category.findMany({ select: { id: true, parentId: true } });
      const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
      for (let p: string | null = parentId, n = 0; p && n < 20; p = parentOf.get(p) ?? null, n++) {
        if (p === id) return bad("A category can't sit under itself");
      }
    }
    data.parentId = parentId;
  }
  if ("imageKey" in b) {
    const k = optText(b.imageKey, 300);
    if (k && !keyBelongsTo(k, tenant.id)) return bad("Unknown image");
    data.imageKey = k;
  }
  if ("sort" in b) data.sort = Number.isInteger(b.sort) ? b.sort : 0;
  if ("active" in b) data.active = b.active === true;
  const category = await db.category.update({ where: { id }, data });
  await audit(db, { actorId: session.userId, action: "category.update", entity: "Category", entityId: id, before, after: category, ip: requestIp(req) });
  return NextResponse.json({ category });
}
