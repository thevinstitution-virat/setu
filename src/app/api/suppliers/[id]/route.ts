import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { parseSupplier } from "@/lib/supplier-api";

/** Edit a supplier. Body: any of { name, contactName, phone, email, gstin, address, active }. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("stock.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const before = await auth.db.supplier.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data = parseSupplier(b, true);
  if (typeof data === "string") return NextResponse.json({ error: data }, { status: 400 });
  if (data.name && (await auth.db.supplier.findFirst({ where: { name: data.name as string, id: { not: id } } }))) {
    return NextResponse.json({ error: "Another supplier has that name" }, { status: 409 });
  }
  const supplier = await auth.db.supplier.update({ where: { id }, data });
  await audit(auth.db, { actorId: auth.session.userId, action: "supplier.update", entity: "Supplier", entityId: id, before, after: supplier, ip: requestIp(req) });
  return NextResponse.json({ supplier });
}
