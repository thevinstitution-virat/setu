import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/client";

const SESSION_COOKIE = "setu_session";
const secret = new TextEncoder().encode(
  process.env.SESSION_SECRET ?? "setu-dev-secret-change-me"
);

export type SessionPayload = {
  userId: string;
  role: Role;
  name: string;
};

export async function createSessionCookie(payload: SessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as SessionPayload;
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
    default:
      return "/login";
  }
}
