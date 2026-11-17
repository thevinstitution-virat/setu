import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "SALES_AGENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ retailers: [] });

  const start = new Date(todayStr() + "T00:00:00");

  const retailers = await prisma.retailerProfile.findMany({
    where: { salesAgentId: agent.id },
    include: {
      user: true,
      area: true,
      visits: { where: { checkInAt: { gte: start } }, orderBy: { checkInAt: "desc" }, take: 1 },
    },
    orderBy: { outletName: "asc" },
  });

  return NextResponse.json({ retailers });
}
