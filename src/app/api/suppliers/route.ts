import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { parseSupplier } from "@/lib/supplier-api";

/** Suppliers (principal companies), active first, with product and open purchase order counts. */
export async function GET() {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const suppliers = await auth.db.supplier.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: { _count: { select: { products: true, purchaseOrders: { where: { status: { in: ["DRAFT", "SENT", "PARTLY_RECEIVED"] } } } } } },
  });
  return NextResponse.json({ suppliers });
}

/** Body: { name, contactName?, phone?, email?, gstin?, address? } */
export async function POST(req: Request) {
  const auth = await guard("stock.manage");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data = parseSupplier(b, false);
  if (typeof data === "string") return NextResponse.json({ error: data }, { status: 400 });
  if (await auth.db.supplier.findFirst({ where: { name: data.name as string } })) return NextResponse.json({ error: "That supplier is already added" }, { status: 409 });
  const supplier = await auth.db.supplier.create({ data: data as { name: string } });
  await audit(auth.db, { actorId: auth.session.userId, action: "supplier.create", entity: "Supplier", entityId: supplier.id, after: supplier, ip: requestIp(req) });
  return NextResponse.json({ supplier }, { status: 201 });
}
