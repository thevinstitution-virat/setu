import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenant } from "@/lib/tenant";
import { requestIp } from "@/lib/audit";
import { platformAudit } from "@/lib/platform-auth";
import { hashPassword } from "@/lib/password";
import { APP_NAME } from "@/lib/brand";
import { passwordProblem, readPlatformResetToken, spendPlatformResetToken } from "@/lib/email-auth";
import { sendEmail } from "@/lib/email";
import { passwordChangedMail } from "@/lib/email-messages";

/** GET ?t= — is the link still good. POST { token, password } — new console password (12+), every console session ends. */
export async function GET(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: !!(await readPlatformResetToken(new URL(req.url).searchParams.get("t"))) });
}

export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const r = await readPlatformResetToken(body?.token);
  if (!r) return NextResponse.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 400 });
  const u = await prisma.platformUser.findUnique({ where: { id: r.platformUserId }, select: { id: true, email: true, active: true } });
  if (!u || !u.active) return NextResponse.json({ error: "This console login is switched off" }, { status: 403 });

  const problem = passwordProblem(body?.password, u.email.split("@")[0], 12);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (!(await spendPlatformResetToken(r.id, u.id))) {
    return NextResponse.json({ error: "This link has expired or was already used. Ask for a new one." }, { status: 400 });
  }

  await prisma.platformUser.update({ where: { id: u.id }, data: { passwordHash: hashPassword(body.password), sessionVersion: { increment: 1 } } });
  await platformAudit(u.id, "auth.password_reset", { ip: requestIp(req) });
  await sendEmail(passwordChangedMail(u.email, `${APP_NAME} console`)).catch(() => null);
  return NextResponse.json({ ok: true, redirect: "/platform/login?notice=password-reset" });
}
