import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

export async function GET() {
  const auth = await guard("team.view");
  if (!auth.ok) return auth.res;
  const { db } = auth;
  const agents = await db.deliveryAgentProfile.findMany({
    include: { user: true },
  });
  return NextResponse.json({ agents });
}
