import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { cashInHand, withMoney } from "@/lib/ledger";

/** Field staff: my cash in hand, what I collected today, my last handovers. */
export async function GET() {
  const auth = await guard("payments.collect");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;

  const held = await withMoney(tenant.id, session.userId, (ctx) => cashInHand(ctx, session.userId));
  const lastHandover = await db.cashHandover.findFirst({
    where: { staffUserId: session.userId },
    orderBy: { createdAt: "desc" },
  });
  // "Today" in IST.
  const istNow = new Date(Date.now() + 5.5 * 3_600_000);
  const dayStart = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 5.5 * 3_600_000);
  const today = await db.payment.findMany({
    where: { collectedById: session.userId, collectedAt: { gte: dayStart }, state: { in: ["CONFIRMED", "REVERSED"] } },
    orderBy: { collectedAt: "desc" },
    include: { retailer: { select: { outletName: true } }, cheque: { select: { number: true, bank: true, status: true } } },
  });
  const byMethod: Record<string, number> = {};
  for (const p of today) if (p.state === "CONFIRMED") byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;

  return NextResponse.json({
    cashInHand: held,
    /** Cash that was already with you before today (not handed over yet). */
    carriedForward: Math.max(0, held - (byMethod.CASH ?? 0)),
    today,
    todayByMethod: byMethod,
    lastHandover,
  });
}
