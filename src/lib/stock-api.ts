import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney, type Ctx } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import type { Permission } from "@/lib/permissions";

/**
 * A stock change: permission check, body, one transaction (lib/stock.ts
 * functions throw MoneyError for rule breaks), audit log, JSON answer.
 */
export async function stockMutation<T>(
  req: Request,
  action: string,
  run: (ctx: Ctx, body: Record<string, unknown>) => Promise<T>,
  opts: { perm?: Permission | Permission[]; entity?: string; entityId?: string | null; status?: number } = {}
) {
  const auth = await guard(opts.perm ?? "stock.manage");
  if (!auth.ok) return auth.res;
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  let result: T;
  try {
    result = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => run(ctx, body));
  } catch (e) {
    return moneyFail(e);
  }
  const id = opts.entityId ?? (result && typeof result === "object" && "id" in result ? String((result as { id: unknown }).id) : null);
  await audit(auth.db, { actorId: auth.session.userId, action, entity: opts.entity ?? "Stock", entityId: id, after: body, ip: requestIp(req) });
  return NextResponse.json({ ok: true, result }, { status: opts.status ?? 200 });
}

export const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const optStr = (v: unknown, max = 200) => str(v, max) || null;
export const int = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
