import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney, type Ctx } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { MoneyError } from "@/lib/money-error";
import type { Permission } from "@/lib/permissions";
import type { SessionPayload } from "@/lib/auth";
import type { Tx } from "@/lib/db";

/**
 * Route helpers for Phase 7 (messages, complaints, ratings, referrals,
 * announcements): permission (or just "signed in" when null), one tenant
 * transaction, JSON. lib functions throw MoneyError for bad input.
 */

export async function engageRead<T>(perm: Permission | Permission[] | null, run: (ctx: Ctx, s: SessionPayload) => Promise<T>) {
  const auth = await guard(perm ?? undefined);
  if (!auth.ok) return auth.res;
  try {
    return NextResponse.json(await withMoney(auth.tenant.id, auth.session.userId, (ctx) => run(ctx, auth.session)));
  } catch (e) {
    return moneyFail(e);
  }
}

export async function engageWrite<T>(
  req: Request,
  action: string,
  perm: Permission | Permission[] | null,
  run: (ctx: Ctx, body: Record<string, unknown>, s: SessionPayload) => Promise<T>,
  opts: { entity: string; entityId?: string | null; status?: number }
) {
  const auth = await guard(perm ?? undefined);
  if (!auth.ok) return auth.res;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  let result: T;
  try {
    result = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => run(ctx, body, auth.session));
  } catch (e) {
    return moneyFail(e);
  }
  const id = opts.entityId ?? (result && typeof result === "object" && "id" in result ? String((result as { id: unknown }).id) : null);
  await audit(auth.db, { actorId: auth.session.userId, action, entity: opts.entity, entityId: id, after: body, ip: requestIp(req) });
  return NextResponse.json({ ok: true, result }, { status: opts.status ?? 200 });
}

/** The signed-in retailer's shop id. */
export async function myShop(tx: Tx, s: SessionPayload) {
  if (s.role !== "RETAILER") throw new MoneyError("Only shops can do this", 403);
  const r = await tx.retailerProfile.findUnique({ where: { userId: s.userId }, select: { id: true } });
  if (!r) throw new MoneyError("Shop not found", 404);
  return r.id;
}

export const qp = (req: Request) => new URL(req.url).searchParams;

/** ?before=<ISO date> paging cursor. */
export function before(sp: URLSearchParams) {
  const b = sp.get("before");
  if (!b) return null;
  const d = new Date(b);
  return Number.isNaN(d.getTime()) ? null : d;
}
