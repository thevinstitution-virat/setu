import { SignJWT, jwtVerify } from "jose";
import type { SupportMode } from "@/generated/prisma/client";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { platformSecret } from "@/lib/auth";

/**
 * Support sessions (Phase 9). A platform user works inside a business only
 * through one of these:
 *
 *  - started from the console with a reason, READ (default) or WRITE, for at
 *    most 2 hours (default 30 minutes);
 *  - the business sees it: an entry in its audit log at start and end, a
 *    banner while it runs, and the list under Settings → Support access;
 *  - it signs in as the business's hidden support login (User.isSupport:
 *    never listed, never a seat), so everything done is in the audit log
 *    under "VBiz Pro support";
 *  - the sign-in link is single use and lasts 5 minutes; READ sessions may
 *    not change anything (guard refuses every non-GET request).
 */

const AUD = "setu-support";
export const SUPPORT_NAME = "VBiz Pro support";
export const MAX_MINUTES = 120;

export class SupportError extends Error {}

/** The business's hidden support login, made on first use. */
async function supportUserId(tenantId: string) {
  return withTenantTx(tenantId, async (tx) => {
    const u = await tx.user.findFirst({ where: { isSupport: true }, select: { id: true } });
    if (u) {
      await tx.user.update({ where: { id: u.id }, data: { active: true } });
      return u.id;
    }
    const made = await tx.user.create({ data: { name: SUPPORT_NAME, role: "ADMIN", isSupport: true, loginId: `support-${Date.now().toString(36)}`, active: true } });
    return made.id;
  });
}

export async function startSupport(p: { platformUserId: string; platformUserName: string; tenantId: string; reason: string; mode?: SupportMode; minutes?: number; now?: Date }) {
  const reason = p.reason.trim();
  if (reason.length < 5) throw new SupportError("Write why you need access (at least 5 characters)");
  const minutes = Math.min(Math.max(Math.round(p.minutes ?? 30), 5), MAX_MINUTES);
  const now = p.now ?? new Date();
  const tenant = await asPlatform((tx) => tx.tenant.findUnique({ where: { id: p.tenantId }, select: { status: true, slug: true } }));
  if (!tenant || tenant.status === "CLOSED") throw new SupportError("Business not found");
  const userId = await supportUserId(p.tenantId);
  const s = await withTenantTx(p.tenantId, async (tx) => {
    const row = await tx.supportSession.create({
      data: { tenantId: p.tenantId, platformUserId: p.platformUserId, reason: reason.slice(0, 300), mode: p.mode ?? "READ", startedAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000) },
    });
    await tx.auditLog.create({
      data: { actorId: userId, action: "support.start", entity: "SupportSession", entityId: row.id, after: { by: p.platformUserName, reason: row.reason, mode: row.mode, until: row.expiresAt.toISOString() } },
    });
    return row;
  });
  const token = await new SignJWT({ to: p.tenantId }).setProtectedHeader({ alg: "HS256" }).setJti(s.id).setAudience(AUD).setIssuedAt().setExpirationTime("5m").sign(platformSecret());
  return { session: s, token, slug: tenant.slug };
}

/** Use up a sign-in link on the business's own address. */
export async function consumeSupport(token: string, tenantId: string, now = new Date()) {
  let claims: { jti?: string; to?: unknown };
  try {
    ({ payload: claims } = await jwtVerify(token, platformSecret(), { audience: AUD, algorithms: ["HS256"] }));
  } catch {
    throw new SupportError("This support link has expired. Start a new session from the console.");
  }
  if (claims.to !== tenantId || !claims.jti) throw new SupportError("This link is not for this business.");
  const sid = claims.jti;
  return withTenantTx(tenantId, async (tx) => {
    const claimed = await tx.supportSession.updateMany({ where: { id: sid, usedAt: null, endedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new SupportError("This support link was already used or the session ended.");
    const s = await tx.supportSession.findUniqueOrThrow({ where: { id: sid } });
    const user = await tx.user.findFirstOrThrow({ where: { isSupport: true }, select: { id: true, name: true } });
    return { session: s, user };
  });
}

/** The live support session behind a cookie, or null when it ended or ran out. */
export async function activeSupport(tenantId: string, sid: string, now = new Date()) {
  const s = await tenantDb(tenantId).supportSession.findUnique({ where: { id: sid }, select: { id: true, mode: true, expiresAt: true, endedAt: true, reason: true } });
  if (!s || s.endedAt || s.expiresAt <= now) return null;
  return s;
}

export async function endSupport(tenantId: string, sid: string, by: string, now = new Date()) {
  return withTenantTx(tenantId, async (tx) => {
    const s = await tx.supportSession.findUnique({ where: { id: sid } });
    if (!s || s.endedAt) return s;
    const row = await tx.supportSession.update({ where: { id: sid }, data: { endedAt: now < s.expiresAt ? now : s.expiresAt } });
    const support = await tx.user.findFirst({ where: { isSupport: true }, select: { id: true } });
    await tx.auditLog.create({ data: { actorId: support?.id ?? null, action: "support.end", entity: "SupportSession", entityId: sid, after: { by } } });
    return row;
  });
}
