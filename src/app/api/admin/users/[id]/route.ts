import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { checkStaffFields, type StaffFields } from "@/lib/staff";
import { checkLimit, LimitError } from "@/lib/plans";
import { hashPassword } from "@/lib/password";
import { passwordProblem } from "@/lib/email-auth";
import { changeProblem, type TeamAction } from "@/lib/team-rules";

/**
 * Body: { active?, name?, phone?, supervisorId?, signOut?, resetMfa?, password? } — only the keys sent change.
 * password: sets a new password (they forgot theirs) and signs them out everywhere.
 * Who may change whom: lib/team-rules.ts (the owner's login is off limits; other admins need the owner).
 * signOut: true ends their sessions on every device. resetMfa: true clears their authenticator app and
 * recovery codes (a lost phone) and signs them out; they set it up again at their next sign-in.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("team.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) ?? {};

  const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true, active: true, isOwner: true, isSupport: true, loginId: true } });
  if (!target || target.role === "RETAILER") return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const me = await db.user.findUniqueOrThrow({ where: { id: session.userId }, select: { isOwner: true, isSupport: true } });
  const actions: TeamAction[] = [];
  if (typeof body.active === "boolean") actions.push(body.active ? "activate" : "deactivate");
  if (body.password !== undefined) actions.push("password");
  if (body.resetMfa === true) actions.push("resetMfa");
  if (body.signOut === true) actions.push("signOut");
  if (["name", "phone", "supervisorId", "email"].some((k) => k in body)) actions.push("edit");
  for (const a of actions) {
    const refused = changeProblem({ userId: session.userId, ...me }, target, a);
    if (refused) return NextResponse.json({ error: refused }, { status: a === "deactivate" && id === session.userId ? 400 : 403 });
  }
  let newHash: string | null = null;
  if (body.password !== undefined) {
    const weak = passwordProblem(body.password, target.loginId);
    if (weak) return NextResponse.json({ error: weak }, { status: 400 });
    newHash = hashPassword(body.password);
  }

  const extra = await checkStaffFields(db, id, body);
  if ("error" in extra) return NextResponse.json({ error: extra.error }, { status: 400 });
  const data: StaffFields & { active?: boolean; name?: string } = { ...extra.data };
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

  const resetMfa = body.resetMfa === true;
  const user = await db.user.update({
    where: { id },
    data: {
      ...data,
      ...(newHash ? { passwordHash: newHash } : {}),
      ...(body.signOut === true || resetMfa || newHash ? { sessionVersion: { increment: 1 } } : {}),
      ...(resetMfa ? { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } : {}),
    },
  });
  // A supervisor who is switched off leaves their team without a supervisor.
  if (target.role === "SUPERVISOR" && data.active === false) await db.user.updateMany({ where: { supervisorId: id }, data: { supervisorId: null } });

  await audit(db, { actorId: session.userId, action: "user.update", entity: "User", entityId: id, after: { ...data, ...(body.signOut === true ? { signedOut: true } : {}), ...(resetMfa ? { mfaReset: true } : {}), ...(newHash ? { passwordSet: true } : {}) }, ip: requestIp(req) });

  return NextResponse.json({ user: { id: user.id, active: user.active, name: user.name, phone: user.phone, email: user.email, supervisorId: user.supervisorId } });
}
