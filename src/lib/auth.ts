import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { getTenant } from "@/lib/tenant";

const SESSION_COOKIE = "setu_session";

export function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  return new TextEncoder().encode(s ?? "setu-dev-secret-change-me");
}

export type SessionPayload = {
  userId: string;
  tenantId: string;
  role: Role;
  name: string;
  /** How this session was opened. Only OTP / handoff sessions may hop to another business (Phase 6 multi-distributor). */
  via?: "password" | "otp" | "handoff";
  /** Verified phone (OTP / handoff sessions). */
  phone?: string;
};

export async function createSessionCookie(payload: SessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(sessionSecret());

  // Host-only cookie: never shared between tenant subdomains.
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
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
    const { payload } = await jwtVerify(token, sessionSecret());
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
