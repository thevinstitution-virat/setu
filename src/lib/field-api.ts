import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney, type Ctx } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import type { Permission } from "@/lib/permissions";
import type { Who } from "@/lib/field";

/**
 * A field read: permission, one tenant transaction, JSON. The lib/field.ts
 * functions throw MoneyError for bad input, answered as { error }.
 */
export async function fieldRead<T>(perm: Permission | Permission[], run: (ctx: Ctx, who: Who) => Promise<T>) {
  const auth = await guard(perm);
  if (!auth.ok) return auth.res;
  const who: Who = { userId: auth.session.userId, role: auth.session.role };
  try {
    return NextResponse.json(await withMoney(auth.tenant.id, auth.session.userId, (ctx) => run(ctx, who)));
  } catch (e) {
    return moneyFail(e);
  }
}

export const qp = (req: Request) => new URL(req.url).searchParams;
export const optNum = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
