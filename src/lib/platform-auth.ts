import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { PlatformRole, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { platformSecret } from "@/lib/auth";
import { getTenant } from "@/lib/tenant";

/**
 * Platform console sign-in (us, not tenants). Its own cookie and audience,
 * only on the platform address (no tenant on the host), 12-hour sessions.
 * Every console action is written to PlatformAudit.
 */

const COOKIE = "setu_platform";
const AUD = "setu-platform";

export type PlatformSession = { platformUserId: string; name: string; role: PlatformRole };

/**
 * Console cookies are only made after the second step (lib/platform-mfa.ts); mfa marks that.
 * sv is the login's sessionVersion: a password reset bumps it and ends every console session.
 */
type PlatformClaims = PlatformSession & { mfa: true; sv: number };

export async function createPlatformCookie(s: PlatformSession) {
  const u = await prisma.platformUser.findUnique({ where: { id: s.platformUserId }, select: { sessionVersion: true } });
  const claims: PlatformClaims = { ...s, mfa: true, sv: u?.sessionVersion ?? 0 };
  const token = await new SignJWT({ ...claims }).setProtectedHeader({ alg: "HS256" }).setAudience(AUD).setIssuedAt().setExpirationTime("12h").sign(platformSecret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
}

export async function clearPlatformCookie() {
  (await cookies()).delete(COOKIE);
}

/** The platform user for this request, read fresh (deactivated = signed out at once). Null on tenant hosts. */
export async function getPlatformSession(): Promise<PlatformSession | null> {
  if (await getTenant()) return null;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, platformSecret(), { audience: AUD, algorithms: ["HS256"] });
    const id = payload.platformUserId;
    // Every console login has a second step; cookies from before it existed no longer count.
    if (typeof id !== "string" || payload.mfa !== true) return null;
    const u = await prisma.platformUser.findUnique({ where: { id }, select: { id: true, name: true, role: true, active: true, sessionVersion: true } });
    if (!u?.active) return null;
    if ((typeof payload.sv === "number" ? payload.sv : 0) !== u.sessionVersion) return null;
    return { platformUserId: u.id, name: u.name, role: u.role };
  } catch {
    return null;
  }
}

type Ok = { ok: true; session: PlatformSession };
type Fail = { ok: false; res: NextResponse };

/** Top of every /api/platform route. OWNER-only actions pass "OWNER". */
export async function platformGuard(role?: "OWNER"): Promise<Ok | Fail> {
  if (await getTenant()) return { ok: false, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const session = await getPlatformSession();
  if (!session) return { ok: false, res: NextResponse.json({ error: "Please sign in" }, { status: 401 }) };
  if (role === "OWNER" && session.role !== "OWNER") return { ok: false, res: NextResponse.json({ error: "Only the platform owner can do this" }, { status: 403 }) };
  return { ok: true, session };
}

export async function platformAudit(actorId: string | null, action: string, p: { tenantId?: string | null; detail?: Prisma.InputJsonValue; ip?: string | null } = {}) {
  await prisma.platformAudit.create({ data: { actorId, action, targetTenantId: p.tenantId ?? null, detail: p.detail, ip: p.ip ?? null } });
}
