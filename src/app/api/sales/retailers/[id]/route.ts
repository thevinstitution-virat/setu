import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  const retailer = await db.retailerProfile.findUnique({
    where: { id },
    include: {
      user: true,
      area: true,
      orders: { orderBy: { createdAt: "desc" }, take: 5, include: { items: true } },
      visits: { orderBy: { checkInAt: "desc" }, take: 5 },
    },
  });

  if (!agent || !retailer || retailer.salesAgentId !== agent.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const products = await db.product.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return NextResponse.json({ retailer, products });
}
