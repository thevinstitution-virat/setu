import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSessionCookie, roleHome } from "@/lib/auth";

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

  const user = await db.user.findFirst({
    where: { OR: [{ loginId }, { email: loginId }] },
    omit: { passwordHash: false },
  });

  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid login ID or password" }, { status: 401 });
  }

  if (!user.active) {
    return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
  }

  await createSessionCookie({ userId: user.id, tenantId: tenant.id, role: user.role, name: user.name });

  return NextResponse.json({ ok: true, redirect: roleHome(user.role) });
}
