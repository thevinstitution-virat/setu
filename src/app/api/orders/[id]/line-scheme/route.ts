import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { setLineScheme } from "@/lib/order-scheme";

/**
 * Body: { itemId, scheme (paise, 0 = none), deal: { buy, get } | null } — a
 * scheme or deal the office puts on one line of an open, unbilled order.
 * Needs orders.manage and pricing.manage (the people who set schemes).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("orders.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  if (!can(session.role, "pricing.manage")) return NextResponse.json({ error: "Only the people who set schemes can do this" }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const itemId = typeof body?.itemId === "string" ? body.itemId : "";
  if (!itemId) return NextResponse.json({ error: "Pick a line" }, { status: 400 });
  const scheme = Number(body?.scheme ?? 0);
  const d = body?.deal;
  const deal = d && typeof d === "object" ? { buy: Number(d.buy), get: Number(d.get) } : null;

  const before = await db.orderItem.findFirst({ where: { id: itemId, orderId: id }, select: { extraScheme: true, dealBuy: true, dealGet: true } });
  let order;
  try {
    order = await withMoney(tenant.id, session.userId, (ctx) => setLineScheme(ctx, id, itemId, { scheme, deal }));
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: "order.line_scheme",
    entity: "Order",
    entityId: id,
    before: { itemId, ...before },
    after: { itemId, extraScheme: scheme, dealBuy: deal?.buy ?? null, dealGet: deal?.get ?? null, totalAmount: order.totalAmount },
    ip: requestIp(req),
  });
  return NextResponse.json({ order });
}
