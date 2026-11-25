import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenant } from "@/lib/tenant";
import { verifyPassword } from "@/lib/password";
import { requestIp } from "@/lib/audit";
import { platformAudit } from "@/lib/platform-auth";
import { platformStepOne } from "@/lib/platform-mfa";
import { lockedMessage, loginLocked, recordLogin } from "@/lib/login-limit";

/** Platform console sign-in. Body: { email, password }. Wrong tries are limited (lib/login-limit.ts). */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const ip = requestIp(req);
  const wait = await loginLocked("platform", email, ip);
  if (wait) return NextResponse.json({ error: lockedMessage(wait) }, { status: 429 });
  const u = await prisma.platformUser.findUnique({ where: { email }, omit: { passwordHash: false } });
  if (!u || !u.active || !verifyPassword(password, u.passwordHash)) {
    await recordLogin("platform", email, ip, false);
    await platformAudit(u?.id ?? null, "auth.login_failed", { detail: { email }, ip: ip ?? undefined });
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  await recordLogin("platform", email, ip, true);
  // Step one only: the console opens after the authenticator code (lib/platform-mfa.ts).
  const to = await platformStepOne({ platformUserId: u.id, via: "password" });
  await platformAudit(u.id, "auth.password_ok", { ip: ip ?? undefined });
  return NextResponse.json({ ok: true, redirect: to });
}
