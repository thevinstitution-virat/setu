import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { checkStaffFields } from "@/lib/staff";
import { checkLimit, LimitError } from "@/lib/plans";

/** Body: { active?, name?, phone?, supervisorId?, signOut? } — only the keys sent change. signOut: true ends their sessions on every device. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("team.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) ?? {};

  const target = await db.user.findUnique({ where: { id }, select: { role: true, active: true } });
  if (!target || target.role === "RETAILER") return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  if (id === session.userId && body.active === false) return NextResponse.json({ error: "You can't deactivate yourself" }, { status: 400 });

  const extra = await checkStaffFields(db, id, body);
  if ("error" in extra) return NextResponse.json({ error: extra.error }, { status: 400 });
  const data: { active?: boolean; name?: string; phone?: string | null; supervisorId?: string | null } = { ...extra.data };
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 80);

  if (data.active === true && !target.active) {
    try {
      await checkLimit(db, auth.tenant.id, "staff");
    } catch (e) {
      if (e instanceof LimitError) return NextResponse.json({ error: e.message, code: "limit" }, { status: 402 });
      throw e;
    }
  }

  const user = await db.user.update({ where: { id }, data: { ...data, ...(body.signOut === true ? { sessionVersion: { increment: 1 } } : {}) } });
  // A supervisor who is switched off leaves their team without a supervisor.
  if (target.role === "SUPERVISOR" && data.active === false) await db.user.updateMany({ where: { supervisorId: id }, data: { supervisorId: null } });

  await audit(db, { actorId: session.userId, action: "user.update", entity: "User", entityId: id, after: { ...data, ...(body.signOut === true ? { signedOut: true } : {}) }, ip: requestIp(req) });

  return NextResponse.json({ user: { id: user.id, active: user.active, name: user.name, phone: user.phone, supervisorId: user.supervisorId } });
}
