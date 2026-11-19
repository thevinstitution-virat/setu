import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSession, type SessionPayload } from "@/lib/auth";
import { getTenant, type CurrentTenant } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";
import { entitlements, featureForPath, FEATURES, type Feature } from "@/lib/plans";
import { activeSupport } from "@/lib/support";

type Ok = { ok: true; session: SessionPayload; tenant: CurrentTenant; db: TenantDb };
type Fail = { ok: false; res: NextResponse };

const fail = (error: string, status: number, extra?: Record<string, unknown>): Fail => ({
  ok: false,
  res: NextResponse.json({ error, ...extra }, { status }),
});

/** What a paused business's owner may still do: pay, export, delete, sign in and out. */
const PAUSED_OK = ["/api/admin/billing", "/api/admin/export", "/api/admin/account", "/api/admin/setup", "/api/admin/support-sessions", "/api/auth", "/admin/billing", "/admin/account"];
/** What a read-only support session may still post. */
const READONLY_OK = ["/api/auth/logout", "/api/auth/support/end"];
const under = (path: string, prefixes: string[]) => prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export type GateInput = {
  tenantStatus: CurrentTenant["status"];
  role: SessionPayload["role"];
  path: string | null;
  method: string | null;
  support: { mode: "READ" | "WRITE" } | null;
  features: Set<Feature>;
};

/**
 * The plan, pause and support rules for one request (pure; exported for
 * tests). null = allowed.
 */
export function gate(i: GateInput): { error: string; status: number; code: string; feature?: Feature } | null {
  const path = i.path ?? "";
  if (i.tenantStatus === "SUSPENDED") {
    if (i.role !== "ADMIN" || !under(path, PAUSED_OK)) {
      return { error: "This business is paused. The owner can sign in to see why.", status: 423, code: "paused" };
    }
  }
  if (i.support?.mode === "READ" && i.method && !["GET", "HEAD", "OPTIONS"].includes(i.method) && !under(path, READONLY_OK)) {
    return { error: "This support session is read-only.", status: 403, code: "support_read_only" };
  }
  const f = path ? featureForPath(path) : null;
  if (f && !i.features.has(f)) {
    return { error: `Not in your plan: ${FEATURES[f]}. Move to a plan that has it under Billing.`, status: 402, code: "upgrade", feature: f };
  }
  return null;
}

async function requestPath() {
  const h = await headers();
  return { path: h.get("x-setu-path"), method: h.get("x-setu-method") };
}

/**
 * One call at the top of every API route:
 *
 *   const auth = await guard("catalogue.manage");
 *   if (!auth.ok) return auth.res;
 *   const { session, db } = auth;
 *
 * Checks tenant, session, that the user still exists and is active (so a
 * deactivated agent is locked out at once, not when the cookie expires), and
 * the permission — using the role stored now, not the one in the cookie.
 * Then the plan's modules for this path, a paused business, and support
 * sessions (still live; read-only ones can't change anything).
 */
export async function guard(perm?: Permission | Permission[]): Promise<Ok | Fail> {
  const tenant = await getTenant();
  if (!tenant) return fail("Unknown business address", 404);
  const session = await getSession();
  if (!session) return fail("Please sign in", 401);

  const db = tenantDb(tenant.id);
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { active: true, role: true, name: true, isSupport: true },
  });
  if (!user || !user.active) return fail("This account is not active", 401);

  let support: { mode: "READ" | "WRITE" } | null = null;
  if (user.isSupport) {
    const s = session.supportId ? await activeSupport(tenant.id, session.supportId) : null;
    if (!s) return fail("The support session has ended", 401);
    support = { mode: s.mode };
  }

  const current: SessionPayload = { ...session, role: user.role, name: user.name };
  if (perm && !can(current.role, perm)) return fail("You don't have access to this", 403);

  const { path, method } = await requestPath();
  const blocked = gate({ tenantStatus: tenant.status, role: current.role, path, method, support, features: (await entitlements(tenant.id)).features });
  if (blocked) return fail(blocked.error, blocked.status, { code: blocked.code, feature: blocked.feature });

  return { ok: true, session: current, tenant, db };
}

/**
 * For server pages and layouts: the session if the user is still active in
 * this tenant (role and name read fresh from the database), else null.
 * In a paused business only the owner's session counts.
 */
export async function pageSession(): Promise<SessionPayload | null> {
  const tenant = await getTenant();
  if (!tenant) return null;
  const session = await getSession();
  if (!session) return null;
  const user = await tenantDb(tenant.id).user.findUnique({
    where: { id: session.userId },
    select: { active: true, role: true, name: true, isSupport: true },
  });
  if (!user || !user.active) return null;
  if (user.isSupport && !(session.supportId && (await activeSupport(tenant.id, session.supportId)))) return null;
  if (tenant.status === "SUSPENDED" && user.role !== "ADMIN") return null;
  return { ...session, role: user.role, name: user.name };
}

/** For pages: is this path's module in the plan? (null = core) */
export async function pageFeature(tenantId: string): Promise<{ feature: Feature; allowed: boolean } | null> {
  const { path } = await requestPath();
  const f = path ? featureForPath(path) : null;
  if (!f) return null;
  return { feature: f, allowed: (await entitlements(tenantId)).features.has(f) };
}
