import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { appSecret } from "@/lib/app-secret";

const SESSION_COOKIE = "setu_session";

/** Signs business sessions (and OTP hashes, share links, sign-in tickets). See lib/app-secret.ts. */
export function sessionSecret() {
  return new TextEncoder().encode(appSecret("SESSION_SECRET"));
}

/** Signs console cookies and support links: never the businesses' secret. */
export function platformSecret() {
  return new TextEncoder().encode(appSecret("PLATFORM_SESSION_SECRET"));
}

export type SessionPayload = {
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  /** How this session was opened. Only OTP / handoff sessions may hop to another business (Phase 6 multi-distributor). */
  via?: "password" | "otp" | "handoff" | "welcome" | "support" | "google" | "email";
  /** Support sessions (Phase 9): the SupportSession id; checked on every request. */
  supportId?: string;
  /** Verified phone (OTP / handoff sessions). */
  phone?: string;
  /** The user's sessionVersion when this session was made; a bump ends it (guard / pageSession). */
  sv?: number;
  /** Passed the second step (authenticator, recovery or SMS code). Required for staff; see lib/mfa.ts. */
  mfa?: boolean;
};

const AUDIENCE = "setu-tenant";

export async function createSessionCookie(payload: SessionPayload, maxAgeSec = 60 * 60 * 24 * 30) {
  const u = await tenantDb(payload.tenantId).user.findUnique({ where: { id: payload.userId }, select: { sessionVersion: true } });
  const token = await new SignJWT({ ...payload, sv: u?.sessionVersion ?? 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAgeSec)
    .sign(sessionSecret());

  // Host-only cookie: never shared between tenant subdomains.
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSec,
  });
}

/**
 * The signed-in user for the current request. Returns null when there is no
 * session, or when the session belongs to a different tenant than the host.
 */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    // Sessions made before audiences existed have none; any other audience is another kind of token.
    if (payload.aud !== undefined && payload.aud !== AUDIENCE) return null;
    const session = payload as unknown as SessionPayload;
    const tenant = await getTenant();
    if (!tenant || session.tenantId !== tenant.id) return null;
    return session;
  } catch {
    return null;
  }
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export function roleHome(role: Role): string {
  switch (role) {
    case "ADMIN":
      return "/admin";
    case "RETAILER":
      return "/retailer";
    case "SALES_AGENT":
      return "/sales";
    case "DELIVERY_AGENT":
      return "/delivery";
    case "SUPERVISOR":
      return "/team";
    default:
      return "/login";
  }
}
