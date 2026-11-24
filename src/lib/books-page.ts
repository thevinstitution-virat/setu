import { getTenant } from "@/lib/tenant";
import { pageSession } from "@/lib/guard";
import { can, type Permission } from "@/lib/permissions";
import { tenantDb } from "@/lib/db";
import { MoneyError, withMoney, type Ctx } from "@/lib/ledger";

type SP = Record<string, string | string[] | undefined>;

/** The books pages' checks (same as the APIs), then their data. */
export async function booksPage<T>(fn: (ctx: Ctx, me: { isOwner: boolean; canSetup: boolean; canLock: boolean }) => Promise<T>) {
  const [tenant, session] = await Promise.all([getTenant(), pageSession()]);
  if (!tenant || !session) return { ok: false as const, error: "Please sign in" };
  if (!can(session.role, "accounts.view" as Permission)) return { ok: false as const, error: "You don't have access to the books" };
  const user = await tenantDb(tenant.id).user.findUnique({ where: { id: session.userId }, select: { isOwner: true } });
  const me = { isOwner: !!user?.isOwner, canSetup: can(session.role, "accounts.setup"), canLock: can(session.role, "accounts.lock") };
  try {
    const data = await withMoney(tenant.id, session.userId, (ctx) => fn(ctx, me));
    return { ok: true as const, data, me };
  } catch (e) {
    if (e instanceof MoneyError) return { ok: false as const, error: e.message };
    throw e;
  }
}

export function readSearch(raw: SP) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  return sp;
}
