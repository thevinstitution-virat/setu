import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { burnPasswordCheck, verifyPassword } from "@/lib/password";
import { createSessionCookie, roleHome } from "@/lib/auth";
import { requestIp } from "@/lib/audit";
import { lockedMessage, loginLocked, recordLogin } from "@/lib/login-limit";

export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const db = tenantDb(tenant.id);

  const body = await req.json().catch(() => null);
  const loginId = body?.loginId?.trim();
  const password = body?.password ?? "";

  if (!loginId || !password) {
    return NextResponse.json({ error: "Login ID and password are required" }, { status: 400 });
  }

  const ip = requestIp(req);
  const wait = await loginLocked(tenant.id, loginId, ip);
  if (wait) return NextResponse.json({ error: lockedMessage(wait) }, { status: 429 });

  const user = await db.user.findFirst({
    where: { OR: [{ loginId }, { email: loginId }], isSupport: false },
    omit: { passwordHash: false },
  });

  const passwordOk = user?.passwordHash ? verifyPassword(password, user.passwordHash) : burnPasswordCheck(password);
  if (!user || !passwordOk) {
    await recordLogin(tenant.id, loginId, ip, false);
    return NextResponse.json({ error: "Invalid login ID or password" }, { status: 401 });
  }
  await recordLogin(tenant.id, loginId, ip, true);

  if (!user.active) {
    return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
  }

  if (tenant.status === "SUSPENDED" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "This business is paused. Please contact the office.", code: "paused" }, { status: 423 });
  }

  await createSessionCookie({ userId: user.id, tenantId: tenant.id, role: user.role, name: user.name, via: "password" });

  return NextResponse.json({ ok: true, redirect: roleHome(user.role) });
}
