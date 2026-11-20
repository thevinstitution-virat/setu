import { publicTenantUrl } from "@/lib/redirect";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, type Tx } from "@/lib/db";
import { sessionSecret } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { isStateCode, normaliseGstin, validGstin } from "@/lib/gst";
import { otpDevMode, sendOtpSms, OtpError } from "@/lib/otp";
import { startTrial } from "@/lib/billing";
import { cleanPhone } from "@/lib/importers";
import { platformDomain } from "@/lib/tenant";

/**
 * Self-serve sign-up (Phase 9), on the platform address:
 *
 *   1. business details (name, GSTIN → state, address)
 *   2. web address  <slug>.<PLATFORM_DOMAIN>
 *   3. owner: name, mobile (OTP checked here, before a tenant exists), login id, password
 *   4. plan to try, terms
 *
 * One transaction makes the tenant (TRIAL), its subscription (trial) and the
 * owner's ADMIN login. The owner is then sent to the new address with a
 * single-use 10-minute welcome link that signs them in and opens the set-up
 * checklist.
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
/** Addresses nobody can take (routing, ours, or confusing). */
export const RESERVED_SLUGS = new Set([
  "www", "app", "api", "admin", "platform", "static", "cdn", "mail", "demo", "second", "start", "signup", "login",
  "billing", "help", "support", "status", "docs", "blog", "setu", "sellerssetu", "test", "staging", "dev", "assets", "files", "pay",
  // Sound like us, or like mail / DNS / sign-in hosts (phishing look-alikes).
  "console", "auth", "account", "accounts", "secure", "security", "verify", "otp", "sso", "id", "my", "m", "mobile",
  "ns", "ns1", "ns2", "dns", "mx", "smtp", "imap", "pop", "webmail", "email", "ftp", "vpn", "portal", "dashboard",
  "official", "team", "staff", "root", "system", "internal", "legal", "privacy", "terms", "abuse", "noreply", "no-reply",
]);

export class SignupError extends Error {
  constructor(message: string, public field?: string, public status = 400) {
    super(message);
  }
}

export function suggestSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "shop"}-${randomInt(100, 999)}`;
}

/** null = free; else why not. */
export async function slugProblem(slugRaw: string): Promise<string | null> {
  const slug = slugRaw.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) return "Use 3–30 small letters, digits or dashes (not at the start or end)";
  if (slug.includes("--")) return "Two dashes in a row are not allowed";
  if (RESERVED_SLUGS.has(slug)) return "This address is reserved";
  const taken = await prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
  return taken ? "This address is taken" : null;
}

// ───────────────────────────── phone check ─────────────────────────────

const OTP_TTL = 10 * 60_000;
const VERIFIED_TTL = 30 * 60_000;
const pepper = () => process.env.SESSION_SECRET ?? "setu-dev-secret-change-me";
const codeHash = (id: string, code: string) => createHmac("sha256", pepper()).update(`signup:${id}:${code}`).digest("hex");

export async function requestSignupOtp(phoneRaw: string, ip: string | null, now = new Date()) {
  const phone = cleanPhone(phoneRaw);
  if (!/^[6-9]\d{9}$/.test(phone)) throw new SignupError("Enter a 10-digit mobile number", "phone");
  const [byPhone, byIp] = await Promise.all([
    prisma.signupChallenge.count({ where: { phone, createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } } }),
    ip ? prisma.signupChallenge.count({ where: { ip, createdAt: { gte: new Date(now.getTime() - 3600_000) } } }) : 0,
  ]);
  if (byPhone >= 3 || byIp >= 10) throw new SignupError("Too many codes asked for. Please wait 15 minutes.", "phone", 429);
  const id = randomUUID();
  const code = String(randomInt(100000, 1000000));
  await prisma.signupChallenge.create({ data: { id, phone, codeHash: codeHash(id, code), ip, expiresAt: new Date(now.getTime() + OTP_TTL) } });
  try {
    await sendOtpSms(phone, code, "VBiz Pro");
  } catch (e) {
    if (e instanceof OtpError) throw new SignupError(e.message, "phone", e.status);
    throw e;
  }
  return { challengeId: id, ...(otpDevMode() ? { devCode: code } : {}) };
}

export async function verifySignupOtp(challengeId: string, code: string, now = new Date()) {
  const c = await prisma.signupChallenge.findUnique({ where: { id: challengeId } });
  if (!c || c.usedAt || c.expiresAt <= now) throw new SignupError("The code has expired. Ask for a new one.", "code");
  if (c.verifiedAt) return { phone: c.phone };
  // Claim the try first (atomic), so parallel guesses can't pass the limit.
  const claimed = await prisma.signupChallenge.updateMany({ where: { id: c.id, verifiedAt: null, attempts: { lt: 5 } }, data: { attempts: { increment: 1 } } });
  if (claimed.count === 0) throw new SignupError("Too many wrong codes. Ask for a new one.", "code", 429);
  const given = Buffer.from(codeHash(c.id, code.trim()), "hex");
  const want = Buffer.from(c.codeHash, "hex");
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw new SignupError("That code is not right", "code");
  await prisma.signupChallenge.update({ where: { id: c.id }, data: { verifiedAt: now } });
  return { phone: c.phone };
}

// ───────────────────────────── making the tenant ─────────────────────────────

export type SignupInput = {
  businessName: string;
  legalName?: string | null;
  gstin?: string | null;
  stateCode?: string | null;
  address?: string | null;
  slug: string;
  ownerName: string;
  loginId: string;
  password: string;
  planCode?: string | null;
  acceptTerms: boolean;
  challengeId: string;
};

const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Check the form. Throws SignupError naming the field. */
export function checkSignup(raw: Record<string, unknown>): Omit<SignupInput, "challengeId"> & { challengeId: string } {
  const businessName = s(raw.businessName, 80);
  if (businessName.length < 2) throw new SignupError("Enter the business name", "businessName");
  const gstin = normaliseGstin(raw.gstin) || null;
  if (gstin && !validGstin(gstin)) throw new SignupError("This GSTIN is not valid (check the 15 characters)", "gstin");
  let stateCode = s(raw.stateCode, 2) || null;
  if (gstin) stateCode = gstin.slice(0, 2);
  if (stateCode && !isStateCode(stateCode)) throw new SignupError("Pick the state", "stateCode");
  if (!stateCode) throw new SignupError("Pick the state the business is registered in", "stateCode");
  const slug = s(raw.slug, 30).toLowerCase();
  const ownerName = s(raw.ownerName, 60);
  if (ownerName.length < 2) throw new SignupError("Enter your name", "ownerName");
  const loginId = s(raw.loginId, 40).toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(loginId)) throw new SignupError("Login id: 3–40 letters, digits, dot, dash or underscore", "loginId");
  const password = typeof raw.password === "string" ? raw.password : "";
  if (password.length < 10) throw new SignupError("Password: at least 10 characters", "password");
  if (password.toLowerCase().includes(loginId)) throw new SignupError("Password must not contain the login id", "password");
  if (raw.acceptTerms !== true) throw new SignupError("Please accept the terms and the privacy notice", "acceptTerms");
  const challengeId = s(raw.challengeId, 64);
  if (!challengeId) throw new SignupError("Check your mobile number first", "phone");
  return {
    businessName,
    legalName: s(raw.legalName, 120) || null,
    gstin,
    stateCode,
    address: s(raw.address, 300) || null,
    slug,
    ownerName,
    loginId,
    password,
    planCode: s(raw.planCode, 30) || null,
    acceptTerms: true,
    challengeId,
  };
}

/**
 * The tenant, its trial and its first admin. Shared by sign-up, the CLI and
 * the seed. Runs in a platform transaction.
 */
export async function createTenantRecord(
  tx: Tx,
  p: { slug: string; name: string; legalName?: string | null; gstin?: string | null; stateCode?: string | null; address?: string | null; phone?: string | null; planCode?: string | null; now?: Date },
  admin: { name: string; loginId: string; password: string; phone?: string | null }
) {
  const now = p.now ?? new Date();
  const tenant = await tx.tenant.create({
    data: {
      slug: p.slug,
      name: p.name,
      legalName: p.legalName ?? null,
      gstin: p.gstin ?? null,
      stateCode: p.stateCode ?? null,
      address: p.address ?? null,
      phone: p.phone ?? null,
      status: "TRIAL",
      plan: "trial",
      onboarding: { startedAt: now.toISOString() },
    },
  });
  await startTrial(tx, tenant.id, now, p.planCode ?? null);
  const user = await tx.user.create({
    data: { tenantId: tenant.id, name: admin.name, loginId: admin.loginId, phone: admin.phone ?? null, passwordHash: hashPassword(admin.password), role: "ADMIN" },
    select: { id: true, name: true, role: true },
  });
  return { tenant, user };
}

export async function signup(raw: Record<string, unknown>, ip: string | null, now = new Date()) {
  const input = checkSignup(raw);
  const problem = await slugProblem(input.slug);
  if (problem) throw new SignupError(problem, "slug");
  if (input.planCode) {
    const plan = await prisma.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || !plan.active || !plan.public) throw new SignupError("Pick one of the plans on offer", "planCode");
  }
  const result = await asPlatform(async (tx) => {
    const used = await tx.signupChallenge.updateMany({
      where: { id: input.challengeId, verifiedAt: { gte: new Date(now.getTime() - VERIFIED_TTL) }, usedAt: null },
      data: { usedAt: now },
    });
    if (used.count !== 1) throw new SignupError("Check your mobile number again (the code ran out)", "phone");
    const c = await tx.signupChallenge.findUniqueOrThrow({ where: { id: input.challengeId } });
    const made = await createTenantRecord(
      tx,
      { slug: input.slug, name: input.businessName, legalName: input.legalName, gstin: input.gstin, stateCode: input.stateCode, address: input.address, phone: c.phone, planCode: input.planCode, now },
      { name: input.ownerName, loginId: input.loginId, password: input.password, phone: c.phone }
    );
    await tx.platformAudit.create({ data: { action: "tenant.signup", targetTenantId: made.tenant.id, detail: { slug: input.slug, plan: input.planCode ?? "trial" }, ip } });
    return made;
  }).catch((e: unknown) => {
    if (e instanceof SignupError) throw e;
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw new SignupError("This address was just taken. Pick another.", "slug");
    throw e;
  });
  const token = await signWelcome(result.tenant.id, result.user.id);
  return { tenant: result.tenant, user: result.user, token };
}

// ───────────────────────────── welcome link ─────────────────────────────

const WELCOME_AUD = "setu-welcome";

export async function signWelcome(tenantId: string, userId: string) {
  return new SignJWT({ to: tenantId, uid: userId }).setProtectedHeader({ alg: "HS256" }).setJti(randomUUID()).setAudience(WELCOME_AUD).setIssuedAt().setExpirationTime("10m").sign(sessionSecret());
}

/** Use up a welcome link on the new business's address. Returns the owner to sign in. */
export async function consumeWelcome(token: string, tenantId: string) {
  let claims: { jti?: string; to?: unknown; uid?: unknown };
  try {
    ({ payload: claims } = await jwtVerify(token, sessionSecret(), { audience: WELCOME_AUD, algorithms: ["HS256"] }));
  } catch {
    throw new SignupError("This link has expired. Sign in with your login id and password.", undefined, 401);
  }
  if (claims.to !== tenantId || typeof claims.uid !== "string" || !claims.jti) throw new SignupError("This link is not for this business.", undefined, 401);
  const db = tenantDb(tenantId);
  const user = await db.user.findUnique({ where: { id: claims.uid }, select: { id: true, name: true, role: true, active: true } });
  if (!user?.active || user.role !== "ADMIN") throw new SignupError("This link can't be used any more.", undefined, 401);
  try {
    await db.handoffUse.create({ data: { id: claims.jti, userId: user.id } });
  } catch {
    throw new SignupError("This link was already used. Sign in with your login id and password.", undefined, 401);
  }
  return user;
}

/**
 * <scheme>://<slug>.<domain>[:port]<path> for links we hand out (welcome, support).
 * From PUBLIC_SCHEME / PUBLIC_PORT like message links, not from the request: behind the
 * proxy req.url carries the container's own scheme and port.
 */
export function tenantAddress(_reqUrl: string, slug: string, path: string) {
  return publicTenantUrl(slug, platformDomain(), path);
}
