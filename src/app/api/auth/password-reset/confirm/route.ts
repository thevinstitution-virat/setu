import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { audit, requestIp } from "@/lib/audit";
import { hashPassword } from "@/lib/password";
import { passwordProblem, readResetToken, spendResetToken } from "@/lib/email-auth";
import { sendEmail } from "@/lib/email";
import { passwordChangedMail } from "@/lib/email-messages";

/**
 * POST { token, password } — sets the new password from a reset link, ends
 * every session of that login (sessionVersion) and tells the address.
 * GET ?t= — whether the link is still good (the page asks before showing the form).
 */
export async function GET(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const c = await readResetToken(tenantDb(tenant.id), new URL(req.url).searchParams.get("t"));
  return NextResponse.json({ ok: !!c });
}

export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const db = tenantDb(tenant.id);
  const body = await req.json().catch(() => null);

  const c = await readResetToken(db, body?.token);
  if (!c) return NextResponse.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 400 });
  const user = await db.user.findUnique({ where: { id: c.userId }, select: { id: true, loginId: true, email: true, active: true } });
  if (!user || !user.active) return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });

  const problem = passwordProblem(body?.password, user.loginId);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (!(await spendResetToken(db, c.id, user.id))) {
    return NextResponse.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 400 });
  }

  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(body.password), sessionVersion: { increment: 1 } } });
  await audit(db, { actorId: user.id, action: "auth.password_reset", entity: "User", entityId: user.id, ip: requestIp(req) });
  // Telling them is a courtesy: the reset already happened, so a mail failure doesn't undo it.
  await sendEmail(passwordChangedMail(user.email ?? c.email, tenant.name)).catch(() => null);
  return NextResponse.json({ ok: true, redirect: "/login?notice=password-reset" });
}
