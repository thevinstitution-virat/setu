import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { bad, parseProduct } from "@/lib/catalogue-api";

/**
 * Product master. Staff with catalogue.manage see everything (incl. hidden
 * and inactive products) with brand and category; other roles get the
 * storefront from /api/catalogue, which applies their rates and visibility.
 */
export async function GET() {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const products = await auth.db.product.findMany({
    orderBy: [{ active: "desc" }, { sort: "asc" }, { name: "asc" }],
    include: { category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) ?? {};
  const data = await parseProduct(db, tenant.id, body, false);
  if (typeof data === "string") return bad(data);
  if (await db.product.findFirst({ where: { sku: data.sku as string } })) return bad("That SKU already exists", 409);
  const product = await db.product.create({ data: data as never });
  await audit(db, { actorId: session.userId, action: "product.create", entity: "Product", entityId: product.id, after: product, ip: requestIp(req) });
  return NextResponse.json({ product });
}
