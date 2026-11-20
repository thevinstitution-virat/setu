import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, parseProduct } from "@/lib/catalogue-api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) ?? {};
  const before = await db.product.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const data = await parseProduct(db, tenant.id, body, true);
  if (typeof data === "string") return bad(data);
  if (data.sku && data.sku !== before.sku && (await db.product.findFirst({ where: { sku: data.sku as string } }))) return bad("That SKU already exists", 409);
  const product = await db.product.update({ where: { id }, data: data as never });
  await audit(db, { actorId: session.userId, action: "product.update", entity: "Product", entityId: id, before, after: product, ip: requestIp(req) });
  return NextResponse.json({ product });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  await db.product.update({ where: { id }, data: { active: false } });
  await audit(db, { actorId: session.userId, action: "product.deactivate", entity: "Product", entityId: id, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
