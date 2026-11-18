import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
  const visit = await db.visit.findUnique({ where: { id } });
  if (!agent || !visit || visit.salesAgentId !== agent.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const updated = await db.visit.update({
    where: { id },
    data: { checkOutAt: new Date(), notes: body?.notes },
  });

  return NextResponse.json({ visit: updated });
}
