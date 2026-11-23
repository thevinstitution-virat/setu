import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { platformSecret } from "@/lib/auth";
import { createPlatformCookie } from "@/lib/platform-auth";
import type { MfaStore } from "@/lib/mfa";

/**
 * The console's second step: mandatory for every console login (Owner and
 * Support). Email + password or Google is step one and only leaves this
 * 10-minute cookie; /platform/login/2fa asks for the authenticator code
 * (set up there the first time) or a recovery code. Console logins have no
 * phone on file, so there is no SMS fallback here; a lost phone is reset with
 * `npm run platform:user -- --email … --reset-2fa` on the server.
 */

const COOKIE = "setu_platform_mfa";
const AUD = "setu-platform-mfa";
const SECONDS = 10 * 60;

export type PlatformPending = { platformUserId: string; via: "password" | "google" | "email" };

export async function setPlatformPending(p: PlatformPending) {
  const token = await new SignJWT({ ...p }).setProtectedHeader({ alg: "HS256" }).setAudience(AUD).setIssuedAt().setExpirationTime("10m").sign(platformSecret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SECONDS });
}

export async function readPlatformPending(): Promise<PlatformPending | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, platformSecret(), { audience: AUD, algorithms: ["HS256"] });
    if (typeof payload.platformUserId !== "string") return null;
    return { platformUserId: payload.platformUserId, via: payload.via === "google" ? "google" : payload.via === "email" ? "email" : "password" };
  } catch {
    return null;
  }
}

/** Step two passed: the real console cookie. */
export async function completePlatformSignIn(p: PlatformPending) {
  const u = await prisma.platformUser.findUnique({ where: { id: p.platformUserId }, select: { id: true, name: true, role: true, active: true } });
  if (!u?.active) return false;
  await prisma.platformUser.update({ where: { id: u.id }, data: { lastLoginAt: new Date() } });
  await createPlatformCookie({ platformUserId: u.id, name: u.name, role: u.role });
  (await cookies()).delete(COOKIE);
  return true;
}

export function platformMfaStore(id: string): MfaStore {
  return {
    load: () => prisma.platformUser.findUnique({ where: { id }, select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true, recoveryCodes: true } }),
    claimStep: async (step) =>
      (await prisma.platformUser.updateMany({ where: { id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })).count === 1,
    claimRecovery: async (hash, remaining) => (await prisma.platformUser.updateMany({ where: { id, recoveryCodes: { has: hash } }, data: { recoveryCodes: remaining } })).count === 1,
    enable: async (secretEnc, step, hashes) => {
      await prisma.platformUser.update({ where: { id }, data: { totpSecret: secretEnc, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes } });
    },
    setRecovery: async (hashes) => {
      await prisma.platformUser.update({ where: { id }, data: { recoveryCodes: hashes } });
    },
  };
}
