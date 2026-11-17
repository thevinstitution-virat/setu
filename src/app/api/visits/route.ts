import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "SALES_AGENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const { retailerId, lat, lng } = body ?? {};
  if (!retailerId) return NextResponse.json({ error: "retailerId is required" }, { status: 400 });

  const retailer = await prisma.retailerProfile.findUnique({ where: { id: retailerId } });
  if (!retailer || retailer.salesAgentId !== agent.id) {
    return NextResponse.json({ error: "Retailer not assigned to you" }, { status: 403 });
  }

  const visit = await prisma.visit.create({
    data: { salesAgentId: agent.id, retailerId, checkInLat: lat, checkInLng: lng },
  });

  return NextResponse.json({ visit });
}
