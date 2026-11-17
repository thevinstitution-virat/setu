import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "SALES_AGENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  const retailer = await prisma.retailerProfile.findUnique({
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

  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { name: "asc" } });

  return NextResponse.json({ retailer, products });
}
