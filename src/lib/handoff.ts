import { publicTenantUrl } from "@/lib/redirect";
/**
 * Multi-distributor agents (Phase 6): one person selling for several
 * businesses has a login in each, linked by the same verified phone.
 *
 * Hopping from business A to business B:
 *   - only from a session opened by OTP (or an earlier hop), so the phone
 *     is proven; a password session is sent to B's login page instead;
 *   - A signs a 2-minute, single-use token {jti, phone, from, to};
 *   - B checks it was meant for B, records the jti (a replay hits the
 *     primary key and is refused), and signs in B's active field user with
 *     that phone.
 *
 * Users stay per business (no global identity yet): see docs/PHASE6.md.
 */
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import { asPlatform, tenantDb } from "@/lib/db";
import { sessionSecret } from "@/lib/auth";
import { FIELD_ROLES } from "@/lib/field-settings";
import { platformDomain } from "@/lib/tenant";

const AUD = "setu-handoff";

export type Workspace = { tenantId: string; slug: string; name: string; role: string };

/** Other businesses where an active field user has this phone. */
export async function workspacesFor(phone: string, exceptTenantId: string): Promise<Workspace[]> {
  const rows = await asPlatform((tx) =>
    tx.user.findMany({
      where: { phone, active: true, role: { in: [...FIELD_ROLES] }, tenantId: { not: exceptTenantId }, tenant: { status: { not: "SUSPENDED" } } },
      select: { role: true, tenant: { select: { id: true, slug: true, name: true } } },
      orderBy: { tenant: { name: "asc" } },
    })
  );
  return rows.map((r) => ({ tenantId: r.tenant.id, slug: r.tenant.slug, name: r.tenant.name, role: r.role }));
}

export async function signHandoff(phone: string, from: string, to: string) {
  return new SignJWT({ phone, from, to })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime("2m")
    .sign(sessionSecret());
}

export class HandoffError extends Error {}

/**
 * Check and use up a token on the target business. Returns the user to sign
 * in. Throws HandoffError when the token is bad, expired, for another
 * business, already used, or no active field user there has that phone.
 */
export async function consumeHandoff(token: string, tenantId: string) {
  let claims: { jti?: string; phone?: unknown; to?: unknown };
  try {
    ({ payload: claims } = await jwtVerify(token, sessionSecret(), { audience: AUD }));
  } catch {
    throw new HandoffError("This link has expired. Switch again from the other business.");
  }
  if (claims.to !== tenantId || typeof claims.phone !== "string" || !claims.jti) throw new HandoffError("This link is not for this business.");
  const phone = claims.phone;
  const db = tenantDb(tenantId);
  const user = await db.user.findFirst({ where: { phone, active: true, role: { in: [...FIELD_ROLES] } }, select: { id: true, role: true, name: true } });
  if (!user) throw new HandoffError("You don't have an active login in this business.");
  try {
    await db.handoffUse.create({ data: { id: claims.jti, userId: user.id } });
  } catch {
    throw new HandoffError("This link was already used. Switch again from the other business.");
  }
  return { user, phone };
}

/** Address of another business, on the same scheme and port as this request. */
export function workspaceUrl(_reqUrl: string, slug: string, path: string) {
  return publicTenantUrl(slug, platformDomain(), path);
}
