import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

export async function POST(req: Request) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const { retailerId, lat, lng } = body ?? {};
  if (!retailerId) return NextResponse.json({ error: "retailerId is required" }, { status: 400 });

  const retailer = await db.retailerProfile.findUnique({ where: { id: retailerId } });
  if (!retailer || retailer.salesAgentId !== agent.id) {
    return NextResponse.json({ error: "Retailer not assigned to you" }, { status: 403 });
  }

  const visit = await db.visit.create({
    data: { salesAgentId: agent.id, retailerId, checkInLat: lat, checkInLng: lng },
  });

  return NextResponse.json({ visit });
}
