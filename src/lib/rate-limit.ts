/**
 * Small counters for abuse limits (OTP sends and checks, AI reads, costly
 * actions), shared by every container through the AuthAttempt table. Rows
 * are written with ok = true and no ip, so they never count towards the
 * password lock in login-limit.ts. The daily otp.cleanup deletes rows older
 * than a day, so windows must be a day or shorter.
 */
import { prisma } from "@/lib/prisma";

export const HOUR = 60 * 60_000;
export const DAY = 24 * HOUR;

const k = (key: string) => key.trim().toLowerCase().slice(0, 200);

/** How many hits this scope and key had in the window. */
export async function hits(scope: string, key: string, windowMs: number, now = new Date()) {
  return prisma.authAttempt.count({ where: { scope, key: k(key), ok: true, ip: null, createdAt: { gt: new Date(now.getTime() - windowMs) } } });
}

/** Records one hit. */
export async function hit(scope: string, key: string, now = new Date()) {
  await prisma.authAttempt.create({ data: { scope, key: k(key), ok: true, ip: null, createdAt: now } });
}

/**
 * Records a hit unless the limit is reached. Returns true when the caller is
 * over the limit (nothing recorded). Not atomic: parallel requests can pass a
 * few over the limit, which is fine for these soft caps.
 */
export async function limited(scope: string, key: string, max: number, windowMs: number, now = new Date()) {
  if ((await hits(scope, key, windowMs, now)) >= max) return true;
  await hit(scope, key, now);
  return false;
}
