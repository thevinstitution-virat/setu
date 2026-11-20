import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, optText, ownIds, text } from "@/lib/catalogue-api";
import { keyBelongsTo } from "@/lib/storage";

export async function GET() {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const categories = await auth.db.category.findMany({ orderBy: [{ sort: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });
  return NextResponse.json({ categories });
}

export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const b = (await req.json().catch(() => null)) ?? {};
  const name = text(b.name, 60);
  if (!name) return bad("Name is required");
  if (await db.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) return bad("That category already exists", 409);
  const parentId = typeof b.parentId === "string" && b.parentId ? b.parentId : null;
  if (parentId && !(await ownIds(db, "category", [parentId]))) return bad("Unknown parent category");
  const imageKey = optText(b.imageKey, 300);
  if (imageKey && !keyBelongsTo(imageKey, tenant.id)) return bad("Unknown image");
  const category = await db.category.create({ data: { name, parentId, imageKey, sort: Number.isInteger(b.sort) ? b.sort : 0 } });
  await audit(db, { actorId: session.userId, action: "category.create", entity: "Category", entityId: category.id, after: category, ip: requestIp(req) });
  return NextResponse.json({ category });
}
