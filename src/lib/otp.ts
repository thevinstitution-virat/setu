import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { TenantDb } from "@/lib/db";

/**
 * Phone OTP, stored hashed in OtpChallenge (per tenant, row-level secured).
 *
 * SMS sending goes through sendOtpSms(). No provider is configured yet (owner
 * adds one later), so in dev — or when OTP_DEV_MODE=1 — the code is returned
 * to the client to show on screen. In production without a provider, sending
 * fails loudly instead of silently showing codes.
 */

const TTL_MS = 5 * 60 * 1000;
const VERIFIED_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_WINDOW = 3;
const SEND_WINDOW_MS = 10 * 60 * 1000;

const pepper = process.env.SESSION_SECRET ?? "setu-dev-secret-change-me";

function hash(phone: string, code: string) {
  return createHmac("sha256", pepper).update(`${phone}:${code}`).digest("hex");
}

export function otpDevMode() {
  return process.env.OTP_DEV_MODE === "1" || (process.env.NODE_ENV !== "production" && !process.env.SMS_PROVIDER);
}

export class OtpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** Provider hook. Wire the chosen SMS / WhatsApp provider here. */
async function sendOtpSms(phone: string, code: string, tenantName: string): Promise<void> {
  if (!process.env.SMS_PROVIDER) {
    if (otpDevMode()) return;
    throw new OtpError("SMS is not configured yet. Please contact support.", 503);
  }
  void phone;
  void code;
  void tenantName;
  throw new OtpError(`SMS provider "${process.env.SMS_PROVIDER}" is not implemented yet`, 503);
}

export async function issueOtp(
  db: TenantDb,
  phone: string,
  tenantName: string
): Promise<{ devCode?: string }> {
  const since = new Date(Date.now() - SEND_WINDOW_MS);
  const recent = await db.otpChallenge.count({ where: { phone, createdAt: { gte: since } } });
  if (recent >= MAX_SENDS_PER_WINDOW) {
    throw new OtpError("Too many OTP requests. Please wait 10 minutes and try again.", 429);
  }

  const code = String(randomInt(100000, 1000000));
  await db.otpChallenge.create({
    data: { phone, codeHash: hash(phone, code), expiresAt: new Date(Date.now() + TTL_MS) },
  });
  await sendOtpSms(phone, code, tenantName);
  return otpDevMode() ? { devCode: code } : {};
}

export async function verifyOtp(db: TenantDb, phone: string, code: string): Promise<boolean> {
  const challenge = await db.otpChallenge.findFirst({
    where: { phone, verifiedAt: null, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return false;
  if (challenge.attempts >= MAX_ATTEMPTS) {
    throw new OtpError("Too many wrong attempts. Request a new OTP.", 429);
  }

  const expected = Buffer.from(challenge.codeHash, "hex");
  const given = Buffer.from(hash(phone, code), "hex");
  const ok = expected.length === given.length && timingSafeEqual(expected, given);

  await db.otpChallenge.update({
    where: { id: challenge.id },
    data: ok ? { verifiedAt: new Date() } : { attempts: { increment: 1 } },
  });
  return ok;
}

/** True if this phone passed OTP in the last 15 minutes and that proof is unused. */
export async function isPhoneVerified(db: TenantDb, phone: string): Promise<boolean> {
  const c = await db.otpChallenge.findFirst({
    where: {
      phone,
      consumedAt: null,
      verifiedAt: { gte: new Date(Date.now() - VERIFIED_TTL_MS) },
    },
  });
  return !!c;
}

export async function consumeVerifiedPhone(db: TenantDb, phone: string) {
  await db.otpChallenge.updateMany({
    where: { phone, consumedAt: null, verifiedAt: { not: null } },
    data: { consumedAt: new Date() },
  });
}
