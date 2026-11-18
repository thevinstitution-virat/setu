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
  if (!agent) return NextResponse.json({ retailers: [] });

  const start = new Date(todayStr() + "T00:00:00");

  const retailers = await db.retailerProfile.findMany({
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
