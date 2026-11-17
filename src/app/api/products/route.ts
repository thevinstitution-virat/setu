import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const products = await prisma.product.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ products });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const { name, sku, category, unit, price, mrp, gstRate, specialOffer, imageUrl } = body ?? {};
  if (!name || !sku || !category || !unit || price == null || mrp == null) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }
  const product = await prisma.product.create({
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
  return NextResponse.json({ product });
}
