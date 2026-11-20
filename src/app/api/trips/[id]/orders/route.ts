import { NextResponse } from "next/server";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { queueEInvoice } from "@/lib/einvoice-queue";
import { addOrders, removeOrder } from "@/lib/trips";
import { tripAuth } from "@/lib/trip-api";
import { can } from "@/lib/permissions";

/** Put orders on the trip. Body: { orderIds: string[], stockOverride? }. On a trip that has left they go out (and on the van) at once. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id);
  if (!a.ok) return a.res;
  const body = await req.json().catch(() => null);
  const orderIds = Array.isArray(body?.orderIds) ? body.orderIds.map(String) : [];
  let docs;
  try {
    const stockOverride = body?.stockOverride === true && can(a.session.role, "stock.manage");
    docs = await withMoney(a.tenant.id, a.session.userId, (ctx) => addOrders(ctx, id, orderIds, { stockOverride }));
  } catch (e) {
    return moneyFail(e);
  }
  for (const d of docs) await queueEInvoice(a.tenant.id, d);
  await audit(a.db, { actorId: a.session.userId, action: "trip.add_orders", entity: "Trip", entityId: id, after: { orderIds }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, invoiced: docs.length });
}

/** Take an order off a trip that hasn't left. ?orderId= */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await tripAuth(id);
  if (!a.ok) return a.res;
  const orderId = new URL(req.url).searchParams.get("orderId") ?? "";
  try {
    await withMoney(a.tenant.id, a.session.userId, (ctx) => removeOrder(ctx, id, orderId));
  } catch (e) {
    return moneyFail(e);
  }
  await audit(a.db, { actorId: a.session.userId, action: "trip.remove_order", entity: "Trip", entityId: id, after: { orderId }, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
