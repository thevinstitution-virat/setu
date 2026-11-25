import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/client";
import { createSessionCookie, roleHome, sessionSecret, type SessionPayload } from "@/lib/auth";
import { tenantDb, type TenantDb } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { hashRecovery, matchTotp, newRecoveryCodes, newTotpSecret, spendRecoveryCode } from "@/lib/totp";

/**
 * Two-step sign-in for business users.
 *
 * Step one is any of the usual ways in (password, mobile OTP, Google, a
 * business switch, the welcome link). For anyone who needs step two —
 * every staff login, and shops that turned it on — step one only leaves a
 * 10-minute "half signed in" cookie; /login/2fa then asks for the code from
 * the authenticator app (set up there on first sign-in), a recovery code,
 * or an SMS code to the phone on file. Only then is the real session made,
 * carrying mfa: true. guard() and pageSession() refuse sessions without it
 * for those people, so sessions from before this existed end at once.
 *
 * Support sessions from the console skip it: the console sign-in already
 * had its own second step.
 */

export type Via = NonNullable<SessionPayload["via"]>;

/** Staff always; a shop only after turning it on. */
export const twoStepOff = () => process.env.TWO_STEP_OFF !== "0";

/**
 * The authenticator step is OFF for everyone (owner's decision, 26 Nov 2026): the emailed
 * one-time code is the only sign-in. Secrets already saved are kept. Set TWO_STEP_OFF=0 to
 * bring the mandatory step back for staff and the console.
 */
export const mfaRequired = (role: Role, totpEnabledAt: Date | null | undefined) => !twoStepOff() && (role !== "RETAILER" || !!totpEnabledAt);

/**
 * The SMS fallback proves the phone. When step one already did (mobile OTP
 * or a switch that rode on one), an SMS can't be step two as well.
 */
export const smsFallbackAllowed = (via: Via) => via !== "otp" && via !== "handoff";

const PENDING_COOKIE = "setu_mfa";
const PENDING_AUD = "setu-mfa";
const PENDING_SECONDS = 10 * 60;

export type Pending = {
  userId: string;
  tenantId: string;
  via: Via;
  phone?: string;
  /** Where to go after step two (welcome link → set-up checklist); else the role's home. */
  next?: string;
};

async function setPending(p: Pending) {
  const token = await new SignJWT({ ...p })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(PENDING_AUD)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + PENDING_SECONDS)
    .sign(sessionSecret());
  // Lax, not strict: it is set at the end of the Google round trip and read on the next page.
  (await cookies()).set(PENDING_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: PENDING_SECONDS });
}

/** The half-signed-in person on this business, or null (none, expired, or another business). */
export async function readPending(tenantId: string): Promise<Pending | null> {
  const token = (await cookies()).get(PENDING_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { audience: PENDING_AUD, algorithms: ["HS256"] });
    const p = payload as unknown as Pending;
    if (p.tenantId !== tenantId || typeof p.userId !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

export async function clearPending() {
  (await cookies()).delete(PENDING_COOKIE);
}

const safeNext = (next: string | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : undefined);

/**
 * End of step one. Signs straight in when no second step is needed, else
 * leaves the half-signed-in cookie. Returns where to send the browser.
 */
export async function finishSignIn(tenantId: string, userId: string, via: Via, extra: { phone?: string; next?: string } = {}): Promise<string> {
  const user = await tenantDb(tenantId).user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, totpEnabledAt: true, onboardingDue: true } });
  if (!user) throw new Error("finishSignIn: no such user");
  if (!mfaRequired(user.role, user.totpEnabledAt)) {
    await createSessionCookie({ userId: user.id, tenantId, role: user.role, name: user.name, via, phone: extra.phone });
    return safeNext(extra.next) ?? (user.onboardingDue ? "/welcome" : roleHome(user.role));
  }
  await setPending({ userId: user.id, tenantId, via, ...(extra.phone ? { phone: extra.phone } : {}), ...(safeNext(extra.next) ? { next: extra.next } : {}) });
  return "/login/2fa";
}

/** Step two passed: the real session, marked mfa. */
export async function completeSignIn(p: Pending): Promise<string> {
  const user = await tenantDb(p.tenantId).user.findUnique({ where: { id: p.userId }, select: { role: true, name: true, onboardingDue: true } });
  if (!user) throw new Error("completeSignIn: no such user");
  await createSessionCookie({ userId: p.userId, tenantId: p.tenantId, role: user.role, name: user.name, via: p.via, phone: p.phone, mfa: true });
  await clearPending();
  return safeNext(p.next) ?? (user.onboardingDue ? "/welcome" : roleHome(user.role));
}

// ---- Codes (shared by business users and console users) -------------------

export type MfaRecord = { totpSecret: string | null; totpEnabledAt: Date | null; totpLastStep: number | null; recoveryCodes: string[] };

/**
 * How a code is checked against one kind of user. claimStep and
 * claimRecovery must be conditional updates (only one of two parallel uses
 * of the same code wins).
 */
export type MfaStore = {
  load(): Promise<MfaRecord | null>;
  claimStep(step: number): Promise<boolean>;
  claimRecovery(hash: string, remaining: string[]): Promise<boolean>;
  enable(secretEnc: string, step: number, recoveryHashes: string[]): Promise<void>;
  setRecovery(hashes: string[]): Promise<void>;
};

export function tenantMfaStore(db: TenantDb, userId: string): MfaStore {
  return {
    load: () => db.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true, recoveryCodes: true } }),
    claimStep: async (step) =>
      (await db.user.updateMany({ where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } })).count === 1,
    claimRecovery: async (hash, remaining) => (await db.user.updateMany({ where: { id: userId, recoveryCodes: { has: hash } }, data: { recoveryCodes: remaining } })).count === 1,
    enable: async (secretEnc, step, hashes) => {
      await db.user.update({ where: { id: userId }, data: { totpSecret: secretEnc, totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes } });
    },
    setRecovery: async (hashes) => {
      await db.user.update({ where: { id: userId }, data: { recoveryCodes: hashes } });
    },
  };
}

export type CodeKind = "app" | "recovery";

/**
 * Checks a code from the authenticator app (6 digits) or a recovery code
 * (xxxx-xxxx), and uses it up. Returns which kind passed, or null.
 */
export async function checkSecondFactor(store: MfaStore, code: string, now = Date.now()): Promise<CodeKind | null> {
  const rec = await store.load();
  if (!rec?.totpEnabledAt) return null;
  const digits = code.replace(/\s/g, "");
  if (/^\d{6}$/.test(digits)) {
    const secret = decryptSecret(rec.totpSecret);
    if (!secret) return null;
    const step = matchTotp(secret, digits, rec.totpLastStep, now);
    return step != null && (await store.claimStep(step)) ? "app" : null;
  }
  const remaining = spendRecoveryCode(rec.recoveryCodes, code);
  if (!remaining) return null;
  return (await store.claimRecovery(hashRecovery(code), remaining)) ? "recovery" : null;
}

// ---- Setting up the authenticator app --------------------------------------

const SETUP_COOKIE = "setu_totp_setup";
const SETUP_SECONDS = 15 * 60;

/**
 * A new secret for the app, kept (encrypted) in a short cookie until the
 * person types a code from it — so a half-finished set-up never replaces a
 * working one.
 */
export async function startSetup(): Promise<string> {
  const secret = newTotpSecret();
  (await cookies()).set(SETUP_COOKIE, encryptSecret(secret), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SETUP_SECONDS });
  return secret;
}

/**
 * Checks the first code from the new app; on success saves the secret,
 * makes fresh recovery codes and returns them (shown once).
 */
export async function confirmSetup(store: MfaStore, code: string, now = Date.now()): Promise<string[] | null> {
  const jar = await cookies();
  const secret = decryptSecret(jar.get(SETUP_COOKIE)?.value);
  if (!secret) return null;
  const step = matchTotp(secret, code, null, now);
  if (step == null) return null;
  const codes = newRecoveryCodes();
  await store.enable(encryptSecret(secret), step, codes.map(hashRecovery));
  jar.delete(SETUP_COOKIE);
  return codes;
}

/** Replaces the recovery codes; returns the new ones (shown once). */
export async function renewRecoveryCodes(store: MfaStore): Promise<string[]> {
  const codes = newRecoveryCodes();
  await store.setRecovery(codes.map(hashRecovery));
  return codes;
}
