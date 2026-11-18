import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET() {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ attendance: null });

  const attendance = await db.attendance.findUnique({
    where: { salesAgentId_date: { salesAgentId: agent.id, date: todayStr() } },
  });

  const history = await db.attendance.findMany({
    where: { salesAgentId: agent.id },
    orderBy: { date: "desc" },
    take: 14,
  });

  return NextResponse.json({ attendance, history });
}

export async function POST(req: Request) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const { action, lat, lng } = body;
  const date = todayStr();

  if (action === "checkin") {
    const attendance = await db.attendance.upsert({
      where: { salesAgentId_date: { salesAgentId: agent.id, date } },
      update: {},
      create: { salesAgentId: agent.id, date, checkInAt: new Date(), checkInLat: lat, checkInLng: lng },
    });
    return NextResponse.json({ attendance });
  }

  if (action === "checkout") {
    const attendance = await db.attendance.update({
      where: { salesAgentId_date: { salesAgentId: agent.id, date } },
      data: { checkOutAt: new Date() },
    });
    return NextResponse.json({ attendance });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
