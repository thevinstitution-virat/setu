import { NextResponse } from "next/server";
import { getSession, type SessionPayload } from "@/lib/auth";
import { getTenant, type CurrentTenant } from "@/lib/tenant";
import { tenantDb, type TenantDb } from "@/lib/db";
import { can, type Permission } from "@/lib/permissions";

type Ok = { ok: true; session: SessionPayload; tenant: CurrentTenant; db: TenantDb };
type Fail = { ok: false; res: NextResponse };

const fail = (error: string, status: number): Fail => ({
  ok: false,
  res: NextResponse.json({ error }, { status }),
});

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
 */
export async function guard(perm?: Permission | Permission[]): Promise<Ok | Fail> {
  const tenant = await getTenant();
  if (!tenant) return fail("Unknown business address", 404);
  const session = await getSession();
  if (!session) return fail("Please sign in", 401);

  const db = tenantDb(tenant.id);
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { active: true, role: true, name: true },
  });
  if (!user || !user.active) return fail("This account is not active", 401);

  const current: SessionPayload = { ...session, role: user.role, name: user.name };
  if (perm && !can(current.role, perm)) return fail("You don't have access to this", 403);

  return { ok: true, session: current, tenant, db };
}

/**
 * For server pages and layouts: the session if the user is still active in
 * this tenant (role and name read fresh from the database), else null.
 */
export async function pageSession(): Promise<SessionPayload | null> {
  const tenant = await getTenant();
  if (!tenant) return null;
  const session = await getSession();
  if (!session) return null;
  const user = await tenantDb(tenant.id).user.findUnique({
    where: { id: session.userId },
    select: { active: true, role: true, name: true },
  });
  if (!user || !user.active) return null;
  return { ...session, role: user.role, name: user.name };
}
