import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("retailers.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const salesAgentId = typeof body?.salesAgentId === "string" && body.salesAgentId ? body.salesAgentId : null;
  // Foreign keys ignore row-level security: check the agent is ours.
  if (salesAgentId && !(await db.salesAgentProfile.findUnique({ where: { id: salesAgentId }, select: { id: true } }))) {
    return NextResponse.json({ error: "Salesperson not found" }, { status: 404 });
  }

  const before = await db.retailerProfile.findUnique({ where: { id }, select: { salesAgentId: true } });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const retailer = await db.retailerProfile.update({
    where: { id },
    data: { salesAgentId },
  });

  await audit(db, { actorId: session.userId, action: "retailer.assign_agent", entity: "RetailerProfile", entityId: id, before, after: { salesAgentId }, ip: requestIp(req) });

  return NextResponse.json({ retailer });
}
