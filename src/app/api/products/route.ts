import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

const isPaise = (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 0;

export async function GET() {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { db } = auth;
  const products = await db.product.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  const auth = await guard("catalogue.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const body = await req.json().catch(() => null);
  const { name, sku, category, unit, price, mrp, gstRate, specialOffer, imageUrl } = body ?? {};
  if (!name || !sku || !category || !unit || price == null || mrp == null) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }
  if (!isPaise(price) || !isPaise(mrp)) {
    return NextResponse.json({ error: "price and mrp must be whole paise" }, { status: 400 });
  }
  if (await db.product.findFirst({ where: { sku } })) {
    return NextResponse.json({ error: "That SKU already exists" }, { status: 400 });
  }
  const product = await db.product.create({
    data: {
      name,
      sku,
      category,
      unit,
      price: Number(price),
      mrp: Number(mrp),
      gstRate: gstRate != null ? Number(gstRate) : 0,
      specialOffer: specialOffer || null,
      imageUrl,
    },
  });
  await audit(db, { actorId: session.userId, action: "product.create", entity: "Product", entityId: product.id, after: product, ip: requestIp(req) });
  return NextResponse.json({ product });
}
