import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  for (const key of ["name", "category", "unit", "imageUrl", "specialOffer", "active"] as const) {
    if (key in body) data[key] = body[key];
  }
  for (const key of ["price", "mrp"] as const) {
    if (key in body) {
      const v = Number(body[key]);
      if (!Number.isInteger(v) || v < 0) {
        return NextResponse.json({ error: `${key} must be whole paise` }, { status: 400 });
      }
      data[key] = v;
    }
  }
  if ("gstRate" in body) data.gstRate = Number(body.gstRate);
  const before = await db.product.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const product = await db.product.update({ where: { id }, data });
  await audit(db, { actorId: session.userId, action: "product.update", entity: "Product", entityId: id, before, after: product, ip: requestIp(req) });
  return NextResponse.json({ product });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  await db.product.update({ where: { id }, data: { active: false } });
  await audit(db, { actorId: session.userId, action: "product.deactivate", entity: "Product", entityId: id, ip: requestIp(_req) });
  return NextResponse.json({ ok: true });
}
