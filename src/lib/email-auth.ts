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
/** A set-password link the platform console makes for a business admin (sent by WhatsApp or email): 3 days. */
export const SET_PASSWORD_TTL_MS = 72 * 3_600_000;
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

/**
 * The login this address belongs to, verified or not (the admin vouches for the staff addresses they type
 * in, and a new shop's address is proved by the code itself). A verified owner wins over an unverified one.
 */
export async function userByEmail(db: TenantDb, email: string) {
  const rows = await db.user.findMany({
    where: { email: { equals: email, mode: "insensitive" }, isSupport: false },
    select: { id: true, name: true, role: true, active: true, loginId: true, email: true, emailVerifiedAt: true },
    orderBy: { createdAt: "asc" },
    take: 5,
  });
  return rows.find((r) => r.emailVerifiedAt) ?? rows[0] ?? null;
}

/** A new sign-in or verification code for this person and address (returned for the caller to send). */
export async function issueEmailCode(db: TenantDb, userId: string, email: string, purpose: "SIGN_IN" | "VERIFY", now = Date.now(), useCode?: string): Promise<string> {
  const recent = await db.emailChallenge.count({ where: { email, purpose, createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many codes asked for. Please wait 10 minutes and try again.", 429);
  const code = useCode ?? String(randomInt(100000, 1000000));
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

/** A reset link token for this login (returned for the caller to put in the link). `email` may be "" (a console-made link). */
export async function issueResetToken(db: TenantDb, userId: string, email: string, now = Date.now(), ttlMs = RESET_TTL_MS): Promise<string> {
  const recent = await db.emailChallenge.count({ where: { userId, purpose: "RESET", createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many reset emails asked for. Please wait 10 minutes and try again.", 429);
  const secret = randomBytes(32).toString("base64url");
  const row = await db.emailChallenge.create({ data: { userId, email, purpose: "RESET", codeHash: "pending", expiresAt: new Date(now + ttlMs) } });
  await db.emailChallenge.update({ where: { id: row.id }, data: { codeHash: linkHash("user", row.id, secret) } });
  return `${row.id}.${secret}`;
}

const splitToken = (token: unknown) => {
  if (typeof token !== "string") return null;
  const [id, secret, extra] = token.split(".");
  return id && secret && extra === undefined && id.length <= 40 && secret.length <= 64 ? { id, secret } : null;
};

type LinkPurpose = "RESET" | "LINK";

async function readLinkToken(db: TenantDb, token: unknown, purpose: LinkPurpose, now: number) {
  const t = splitToken(token);
  if (!t) return null;
  const c = await db.emailChallenge.findUnique({ where: { id: t.id } });
  if (!c || c.purpose !== purpose || c.usedAt || c.expiresAt.getTime() <= now) return null;
  return sameHex(c.codeHash, linkHash("user", c.id, t.secret)) ? c : null;
}

async function spendLinkToken(db: TenantDb, id: string, userId: string, purpose: LinkPurpose, now: number) {
  const won = await db.emailChallenge.updateMany({ where: { id, purpose, usedAt: null }, data: { usedAt: new Date(now) } });
  if (won.count !== 1) return false;
  await db.emailChallenge.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date(now) } });
  return true;
}

/** The open reset challenge a link token belongs to, or null (wrong, expired or used). */
export const readResetToken = (db: TenantDb, token: unknown, now = Date.now()) => readLinkToken(db, token, "RESET", now);

/** Uses a reset link up (only one of two parallel uses wins); also closes this person's other open links. */
export const spendResetToken = (db: TenantDb, id: string, userId: string, now = Date.now()) => spendLinkToken(db, id, userId, "RESET", now);

// ---- One-click sign-in links (business logins) -----------------------------

const SIGN_IN_LINK_TTL_MS = 15 * 60_000;

/** A sign-in link token for this login (15 minutes, once), for an address it confirmed. */
export async function issueSignInLink(db: TenantDb, userId: string, email: string, now = Date.now()): Promise<string> {
  const recent = await db.emailChallenge.count({ where: { userId, purpose: "LINK", createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many sign-in emails asked for. Please wait 10 minutes and try again.", 429);
  const secret = randomBytes(32).toString("base64url");
  const row = await db.emailChallenge.create({ data: { userId, email, purpose: "LINK", codeHash: "pending", expiresAt: new Date(now + SIGN_IN_LINK_TTL_MS) } });
  await db.emailChallenge.update({ where: { id: row.id }, data: { codeHash: linkHash("user", row.id, secret) } });
  return `${row.id}.${secret}`;
}

export const readSignInLink = (db: TenantDb, token: unknown, now = Date.now()) => readLinkToken(db, token, "LINK", now);
export const spendSignInLink = (db: TenantDb, id: string, userId: string, now = Date.now()) => spendLinkToken(db, id, userId, "LINK", now);

// ---- Console password-reset links -----------------------------------------

type PlatformLinkPurpose = "reset" | "link";

async function issuePlatformToken(platformUserId: string, purpose: PlatformLinkPurpose, now: number, ttlMs: number): Promise<string> {
  const recent = await prisma.platformPasswordReset.count({ where: { platformUserId, purpose, createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many emails asked for. Please wait 10 minutes and try again.", 429);
  const secret = randomBytes(32).toString("base64url");
  const id = randomBytes(12).toString("base64url");
  await prisma.platformPasswordReset.create({ data: { id, platformUserId, purpose, tokenHash: linkHash("platform", id, secret), expiresAt: new Date(now + ttlMs) } });
  return `${id}.${secret}`;
}

async function readPlatformToken(token: unknown, purpose: PlatformLinkPurpose, now: number) {
  const t = splitToken(token);
  if (!t) return null;
  const r = await prisma.platformPasswordReset.findUnique({ where: { id: t.id } });
  if (!r || r.purpose !== purpose || r.usedAt || r.expiresAt.getTime() <= now) return null;
  return sameHex(r.tokenHash, linkHash("platform", r.id, t.secret)) ? r : null;
}

async function spendPlatformToken(id: string, platformUserId: string, purpose: PlatformLinkPurpose, now: number) {
  const won = await prisma.platformPasswordReset.updateMany({ where: { id, purpose, usedAt: null }, data: { usedAt: new Date(now) } });
  if (won.count !== 1) return false;
  await prisma.platformPasswordReset.updateMany({ where: { platformUserId, purpose, usedAt: null }, data: { usedAt: new Date(now) } });
  return true;
}

export const issuePlatformResetToken = (platformUserId: string, now = Date.now()) => issuePlatformToken(platformUserId, "reset", now, RESET_TTL_MS);
export const readPlatformResetToken = (token: unknown, now = Date.now()) => readPlatformToken(token, "reset", now);
export const spendPlatformResetToken = (id: string, platformUserId: string, now = Date.now()) => spendPlatformToken(id, platformUserId, "reset", now);

/** Console one-click sign-in links (15 minutes, once); the authenticator code still follows. */
export const issuePlatformSignInLink = (platformUserId: string, now = Date.now()) => issuePlatformToken(platformUserId, "link", now, SIGN_IN_LINK_TTL_MS);
export const readPlatformSignInLink = (token: unknown, now = Date.now()) => readPlatformToken(token, "link", now);
export const spendPlatformSignInLink = (id: string, platformUserId: string, now = Date.now()) => spendPlatformToken(id, platformUserId, "link", now);

// ---- Console one-time codes (the main address's emailed code, for the console login) ----

const PLATFORM_CODE_TTL_MS = 10 * 60_000;

/** Stores the code for a console login (10 minutes); at most 3 per 10 minutes. */
export async function issuePlatformCode(platformUserId: string, code: string, now = Date.now()): Promise<void> {
  const recent = await prisma.platformPasswordReset.count({ where: { platformUserId, purpose: "code", createdAt: { gte: new Date(now - SEND_WINDOW_MS) } } });
  if (recent >= MAX_SENDS) throw new EmailAuthError("Too many codes asked for. Please wait 10 minutes and try again.", 429);
  const id = randomBytes(12).toString("base64url");
  await prisma.platformPasswordReset.create({ data: { id, platformUserId, purpose: "code", tokenHash: linkHash("platform-code", id, code), expiresAt: new Date(now + PLATFORM_CODE_TTL_MS) } });
}

/** True (and the code used up) when this is a live code of the console login. Caller rate-limits tries. */
export async function checkPlatformCode(platformUserId: string, codeRaw: string, now = Date.now()): Promise<boolean> {
  const code = codeRaw.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return false;
  const rows = await prisma.platformPasswordReset.findMany({ where: { platformUserId, purpose: "code", usedAt: null, expiresAt: { gt: new Date(now) } }, orderBy: { createdAt: "desc" }, take: 3 });
  const hit = rows.find((r) => sameHex(r.tokenHash, linkHash("platform-code", r.id, code)));
  if (!hit) return false;
  const won = await prisma.platformPasswordReset.updateMany({ where: { id: hit.id, usedAt: null }, data: { usedAt: new Date(now) } });
  return won.count === 1;
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
