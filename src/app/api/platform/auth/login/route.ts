import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenant } from "@/lib/tenant";
import { verifyPassword } from "@/lib/password";
import { requestIp } from "@/lib/audit";
import { createPlatformCookie, platformAudit } from "@/lib/platform-auth";
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
  await prisma.platformUser.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  await createPlatformCookie({ platformUserId: u.id, name: u.name, role: u.role });
  await platformAudit(u.id, "auth.login", { ip: ip ?? undefined });
  return NextResponse.json({ ok: true, redirect: "/platform" });
}
