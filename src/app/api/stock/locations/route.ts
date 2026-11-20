import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { damagedBin, defaultWarehouse } from "@/lib/stock";
import { optStr, str } from "@/lib/stock-api";

/** Stock places: warehouses, vans (one per vehicle, made when first loaded) and the damaged bin. */
export async function GET() {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  // Make sure the default warehouse and the damaged bin exist.
  await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
    await defaultWarehouse(ctx);
    await damagedBin(ctx);
  });
  const locations = await auth.db.stockLocation.findMany({
    orderBy: [{ kind: "asc" }, { isDefault: "desc" }, { name: "asc" }],
    include: { vehicle: { select: { number: true } } },
  });
  const totals = await auth.db.stockLot.groupBy({ by: ["locationId"], where: { qty: { gt: 0 } }, _sum: { qty: true }, _count: { _all: true } });
  return NextResponse.json({
    locations: locations.map((l) => {
      const t = totals.find((x) => x.locationId === l.id);
      return { ...l, units: t?._sum.qty ?? 0, batches: t?._count._all ?? 0 };
    }),
  });
}

/** Add a warehouse. Body: { name, address? } */
export async function POST(req: Request) {
  const auth = await guard("stock.manage");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const name = str(b.name, 60);
  if (name.length < 2) return NextResponse.json({ error: "Enter the warehouse name" }, { status: 400 });
  if (await auth.db.stockLocation.findFirst({ where: { name } })) return NextResponse.json({ error: "A place with that name exists" }, { status: 409 });
  const location = await auth.db.stockLocation.create({ data: { kind: "WAREHOUSE", name, address: optStr(b.address, 200) } });
  await audit(auth.db, { actorId: auth.session.userId, action: "stock.location_create", entity: "StockLocation", entityId: location.id, after: location, ip: requestIp(req) });
  return NextResponse.json({ location }, { status: 201 });
}
