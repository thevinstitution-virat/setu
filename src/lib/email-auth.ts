import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { EmailPurpose } from "@/generated/prisma/client";
import type { TenantDb } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { appSecret } from "@/lib/app-secret";

/**
 * Email sign-in codes, email verification and password-reset links.
 *
 * Codes (sign-in, verify): 6 digits, 10 minutes, 5 tries, used once, at most
 * 3 sent per address per 10 minutes. Reset links: <id>.<32 random bytes>,
 * 30 minutes, used once; only the secret's HMAC is stored. Only addresses a
 * person verified themselves get sign-in codes and reset links, so an address
 * the office mistyped never receives a way into the account.
 *
 * Sending is the caller's job (lib/email.ts), so these stay testable.
 */

const CODE_TTL_MS = 10 * 60_000;
const RESET_TTL_MS = 30 * 60_000;
const MAX_ATTEMPTS = 5;
const MAX_SENDS = 3;
const SEND_WINDOW_MS = 10 * 60_000;

export class EmailAuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const normaliseEmail = (s: unknown) => (typeof s === "string" ? s.trim().toLowerCase() : "");
export const validEmail = (s: string) => s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(s);

const mac = (parts: string) => createHmac("sha256", appSecret("SESSION_SECRET")).update(parts).digest("hex");
const codeHash = (purpose: EmailPurpose, email: string, code: string) => mac(`email:${purpose}:${email}:${code}`);
const linkHash = (kind: string, id: string, secret: string) => mac(`reset:${kind}:${id}:${secret}`);

const sameHex = (a: string, b: string) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** The active, non-support login whose verified address this is, or null. */
export function userByVerifiedEmail(db: TenantDb, email: string) {
  return db.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, emailVerifiedAt: { not: null }, isSupport: false },
    select: { id: true, name: true, role: true, active: true, loginId: true, email: true },
  });
}

/** A new sign-in or verification code for this person and address (returned for the caller to send). */
export async function issueEmailCode(db: TenantDb, userId: string, email: string, purpose: "SIGN_IN" | "VERIFY", now = Date.now()): Promise<string> {
  const recent = await db.emailChallenge.count({ where: { email, purpose, createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many codes asked for. Please wait 10 minutes and try again.", 429);
  const code = String(randomInt(100000, 1000000));
  await db.emailChallenge.create({ data: { userId, email, purpose, codeHash: codeHash(purpose, email, code), expiresAt: new Date(now + CODE_TTL_MS) } });
  return code;
}

/**
 * Checks a code against the newest open challenge for this address (and
 * person, when given) and uses it up. Returns the challenge, or null.
 */
export async function checkEmailCode(
  db: TenantDb,
  q: { email?: string; userId?: string; purpose: "SIGN_IN" | "VERIFY"; code: string },
  now = Date.now()
) {
  const code = q.code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return null;
  const c = await db.emailChallenge.findFirst({
    where: { purpose: q.purpose, usedAt: null, expiresAt: { gt: new Date(now) }, ...(q.email ? { email: q.email } : {}), ...(q.userId ? { userId: q.userId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!c) return null;
  // Claim the try before comparing, in one statement: parallel guesses can't all slip under the limit.
  const claimed = await db.emailChallenge.updateMany({ where: { id: c.id, usedAt: null, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
  if (claimed.count === 0) throw new EmailAuthError("Too many wrong tries. Ask for a new code.", 429);
  if (!sameHex(c.codeHash, codeHash(c.purpose, c.email, code))) return null;
  const won = await db.emailChallenge.updateMany({ where: { id: c.id, usedAt: null }, data: { usedAt: new Date(now) } });
  return won.count === 1 ? c : null;
}

// ---- Password-reset links (business logins) --------------------------------

/** A reset link token for this login (returned for the caller to put in the link). */
export async function issueResetToken(db: TenantDb, userId: string, email: string, now = Date.now()): Promise<string> {
  const recent = await db.emailChallenge.count({ where: { userId, purpose: "RESET", createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many reset emails asked for. Please wait 10 minutes and try again.", 429);
  const secret = randomBytes(32).toString("base64url");
  const row = await db.emailChallenge.create({ data: { userId, email, purpose: "RESET", codeHash: "pending", expiresAt: new Date(now + RESET_TTL_MS) } });
  await db.emailChallenge.update({ where: { id: row.id }, data: { codeHash: linkHash("user", row.id, secret) } });
  return `${row.id}.${secret}`;
}

const splitToken = (token: unknown) => {
  if (typeof token !== "string") return null;
  const [id, secret, extra] = token.split(".");
  return id && secret && extra === undefined && id.length <= 40 && secret.length <= 64 ? { id, secret } : null;
};

/** The open reset challenge a link token belongs to, or null (wrong, expired or used). */
export async function readResetToken(db: TenantDb, token: unknown, now = Date.now()) {
  const t = splitToken(token);
  if (!t) return null;
  const c = await db.emailChallenge.findUnique({ where: { id: t.id } });
  if (!c || c.purpose !== "RESET" || c.usedAt || c.expiresAt.getTime() <= now) return null;
  return sameHex(c.codeHash, linkHash("user", c.id, t.secret)) ? c : null;
}

/** Uses a reset link up (only one of two parallel uses wins); also closes this person's other open links. */
export async function spendResetToken(db: TenantDb, id: string, userId: string, now = Date.now()) {
  const won = await db.emailChallenge.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date(now) } });
  if (won.count !== 1) return false;
  await db.emailChallenge.updateMany({ where: { userId, purpose: "RESET", usedAt: null }, data: { usedAt: new Date(now) } });
  return true;
}

// ---- Console password-reset links -----------------------------------------

export async function issuePlatformResetToken(platformUserId: string, now = Date.now()): Promise<string> {
  const recent = await prisma.platformPasswordReset.count({ where: { platformUserId, createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many reset emails asked for. Please wait 10 minutes and try again.", 429);
  const secret = randomBytes(32).toString("base64url");
  const id = randomBytes(12).toString("base64url");
  await prisma.platformPasswordReset.create({ data: { id, platformUserId, tokenHash: linkHash("platform", id, secret), expiresAt: new Date(now + RESET_TTL_MS) } });
  return `${id}.${secret}`;
}

export async function readPlatformResetToken(token: unknown, now = Date.now()) {
  const t = splitToken(token);
  if (!t) return null;
  const r = await prisma.platformPasswordReset.findUnique({ where: { id: t.id } });
  if (!r || r.usedAt || r.expiresAt.getTime() <= now) return null;
  return sameHex(r.tokenHash, linkHash("platform", r.id, t.secret)) ? r : null;
}

export async function spendPlatformResetToken(id: string, platformUserId: string, now = Date.now()) {
  const won = await prisma.platformPasswordReset.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date(now) } });
  if (won.count !== 1) return false;
  await prisma.platformPasswordReset.updateMany({ where: { platformUserId, usedAt: null }, data: { usedAt: new Date(now) } });
  return true;
}

// ---- New passwords -----------------------------------------------------------

/** Same rules as sign-up (10+ characters, not the login id); the console asks for 12. */
export function passwordProblem(password: unknown, loginId: string | null | undefined, min = 10): string | null {
  if (typeof password !== "string" || password.length < min) return `Use at least ${min} characters`;
  if (password.length > 200) return "That password is too long";
  const id = (loginId ?? "").toLowerCase();
  if (id.length >= 3 && password.toLowerCase().includes(id)) return "The password must not contain your login id";
  return null;
}
