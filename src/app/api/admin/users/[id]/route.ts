import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("team.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const user = await db.user.update({
    where: { id },
    data: { active: body.active },
  });

  await audit(db, { actorId: session.userId, action: "user.active", entity: "User", entityId: id, after: { active: user.active }, ip: requestIp(req) });

  return NextResponse.json({ user: { id: user.id, active: user.active } });
}
