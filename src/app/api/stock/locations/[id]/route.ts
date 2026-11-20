import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { optStr, str } from "@/lib/stock-api";

/**
 * Edit a warehouse. Body: { name?, address?, isDefault: true (make it the
 * loading warehouse), active? (only when empty) }. Vans and the damaged bin
 * are managed by the system (name only).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("stock.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const loc = await auth.db.stockLocation.findUnique({ where: { id } });
  if (!loc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data: Record<string, unknown> = {};
  if ("name" in b) {
    const name = str(b.name, 60);
    if (name.length < 2) return NextResponse.json({ error: "Enter a name" }, { status: 400 });
    if (await auth.db.stockLocation.findFirst({ where: { name, id: { not: id } } })) return NextResponse.json({ error: "A place with that name exists" }, { status: 409 });
    data.name = name;
  }
  if ("address" in b) data.address = optStr(b.address, 200);
  if (loc.kind === "WAREHOUSE" && "active" in b) {
    const active = b.active === true;
    if (!active) {
      if (loc.isDefault) return NextResponse.json({ error: "Make another warehouse the loading warehouse first" }, { status: 409 });
      const held = await auth.db.stockLot.count({ where: { locationId: id, qty: { gt: 0 } } });
      if (held) return NextResponse.json({ error: "Move the stock out of this warehouse first" }, { status: 409 });
    }
    data.active = active;
  }
  const makeDefault = loc.kind === "WAREHOUSE" && b.isDefault === true && !loc.isDefault;
  const location = await withTenantTx(auth.tenant.id, async (tx) => {
    if (makeDefault) {
      await tx.stockLocation.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      data.isDefault = true;
      data.active = true;
    }
    return tx.stockLocation.update({ where: { id }, data });
  });
  await audit(auth.db, { actorId: auth.session.userId, action: "stock.location_update", entity: "StockLocation", entityId: id, before: loc, after: location, ip: requestIp(req) });
  return NextResponse.json({ location });
}
