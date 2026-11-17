import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "SALES_AGENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  const visit = await prisma.visit.findUnique({ where: { id } });
  if (!agent || !visit || visit.salesAgentId !== agent.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const updated = await prisma.visit.update({
    where: { id },
    data: { checkOutAt: new Date(), notes: body?.notes },
  });

  return NextResponse.json({ visit: updated });
}
