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
  if (!agent) return NextResponse.json({ attendance: null });

  const attendance = await prisma.attendance.findUnique({
    where: { salesAgentId_date: { salesAgentId: agent.id, date: todayStr() } },
  });

  const history = await prisma.attendance.findMany({
    where: { salesAgentId: agent.id },
    orderBy: { date: "desc" },
    take: 14,
  });

  return NextResponse.json({ attendance, history });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "SALES_AGENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { action, lat, lng } = body;
  const date = todayStr();

  if (action === "checkin") {
    const attendance = await prisma.attendance.upsert({
      where: { salesAgentId_date: { salesAgentId: agent.id, date } },
      update: {},
      create: { salesAgentId: agent.id, date, checkInAt: new Date(), checkInLat: lat, checkInLng: lng },
    });
    return NextResponse.json({ attendance });
  }

  if (action === "checkout") {
    const attendance = await prisma.attendance.update({
      where: { salesAgentId_date: { salesAgentId: agent.id, date } },
      data: { checkOutAt: new Date() },
    });
    return NextResponse.json({ attendance });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
