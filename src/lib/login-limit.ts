/**
 * Password sign-in limits (roadmap §8, OWASP basics), shared by every web
 * container through the database:
 *
 *   - 5 wrong passwords for one login in 15 minutes lock that login;
 *   - 30 wrong passwords from one address in 15 minutes lock the address.
 *
 * A right password clears the login's wrong tries. The lock lifts by itself
 * as the old tries leave the 15-minute window. OTP has its own limits (otp.ts).
 */
import { prisma } from "@/lib/prisma";

export const LOGIN_WINDOW_MS = 15 * 60_000;
export const MAX_PER_LOGIN = 5;
export const MAX_PER_IP = 30;

const norm = (key: string) => key.trim().toLowerCase().slice(0, 200);

/** Minutes until a try is allowed again, or 0 when it is allowed now. */
export async function loginLocked(scope: string, key: string, ip: string | null, now = new Date()) {
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [byLogin, byIp] = await Promise.all([
    prisma.authAttempt.findMany({ where: { scope, key: norm(key), ok: false, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    ip ? prisma.authAttempt.findMany({ where: { ip, ok: false, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }) : Promise.resolve([]),
  ]);
  // Locked until enough of the oldest tries have left the window.
  const wait = (rows: { createdAt: Date }[], max: number) => (rows.length < max ? 0 : rows[rows.length - max].createdAt.getTime() + LOGIN_WINDOW_MS - now.getTime());
  const ms = Math.max(wait(byLogin, MAX_PER_LOGIN), wait(byIp, MAX_PER_IP));
  return ms > 0 ? Math.max(1, Math.ceil(ms / 60_000)) : 0;
}

/** Records a try; a right one clears that login's wrong tries. */
export async function recordLogin(scope: string, key: string, ip: string | null, ok: boolean, now = new Date()) {
  const k = norm(key);
  if (ok) await prisma.authAttempt.deleteMany({ where: { scope, key: k, ok: false } });
  await prisma.authAttempt.create({ data: { scope, key: k, ip: ip?.slice(0, 64) ?? null, ok, createdAt: now } });
}

export const lockedMessage = (minutes: number) => `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;

/** Daily clean-up (otp.cleanup): tries older than a day. */
export async function purgeLoginAttempts(now = new Date()) {
  return (await prisma.authAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86_400_000) } } })).count;
}
