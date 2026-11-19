import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenant } from "@/lib/tenant";
import { verifyPassword } from "@/lib/password";
import { requestIp } from "@/lib/audit";
import { createPlatformCookie, platformAudit } from "@/lib/platform-auth";

const fails = new Map<string, { n: number; at: number }>();

/** Platform console sign-in. Body: { email, password }. Five wrong tries lock the address for 15 minutes. */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  const ip = requestIp(req) ?? "?";
  const key = `${ip}:${email}`;
  const f = fails.get(key);
  if (f && f.n >= 5 && Date.now() - f.at < 15 * 60_000) return NextResponse.json({ error: "Too many tries. Wait 15 minutes." }, { status: 429 });
  const u = await prisma.platformUser.findUnique({ where: { email }, omit: { passwordHash: false } });
  if (!u || !u.active || !verifyPassword(password, u.passwordHash)) {
    fails.set(key, { n: (f && Date.now() - f.at < 15 * 60_000 ? f.n : 0) + 1, at: Date.now() });
    await platformAudit(u?.id ?? null, "auth.login_failed", { detail: { email }, ip });
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  fails.delete(key);
  await prisma.platformUser.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  await createPlatformCookie({ platformUserId: u.id, name: u.name, role: u.role });
  await platformAudit(u.id, "auth.login", { ip });
  return NextResponse.json({ ok: true, redirect: "/platform" });
}
