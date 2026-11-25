import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";

/**
 * Body: { salesmanId: string | null } — whose sale this order is, for the
 * salesman-wise outstanding and collection reports. The order's bill moves
 * with it; an invoice already printed keeps the name it was made with
 * (invoices never change).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("orders.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || !("salesmanId" in body)) return NextResponse.json({ error: "salesmanId is required (null to clear)" }, { status: 400 });
  const salesmanId = body.salesmanId === null || body.salesmanId === "" ? null : String(body.salesmanId);

  if (salesmanId) {
    // Foreign ids are not filtered by row-level security on writes, so check it is our own salesman.
    const u = await db.user.findFirst({ where: { id: salesmanId, active: true, role: { in: ["SALES_AGENT", "SUPERVISOR"] } }, select: { id: true } });
    if (!u) return NextResponse.json({ error: "Salesman not found" }, { status: 404 });
  }

  const order = await db.order.findUnique({
    where: { id },
    select: { id: true, salesmanId: true, status: true, invoices: { where: { type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } }, select: { number: true, salesman: true }, take: 1 } },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.status === "CANCELLED") return NextResponse.json({ error: "This order is cancelled" }, { status: 409 });
  if (order.salesmanId === salesmanId) return NextResponse.json({ salesmanId, unchanged: true });

  await withTenantTx(auth.tenant.id, async (tx) => {
    await tx.order.update({ where: { id }, data: { salesmanId } });
    await tx.bill.updateMany({ where: { orderId: id }, data: { salesmanId } });
  });
  await audit(db, {
    actorId: session.userId,
    action: "order.salesman",
    entity: "Order",
    entityId: id,
    before: { salesmanId: order.salesmanId },
    after: { salesmanId },
    ip: requestIp(req),
  });
  const invoice = order.invoices[0];
  return NextResponse.json({
    salesmanId,
    note: invoice ? `Reports now use the new salesman. Invoice ${invoice.number} already printed keeps ${invoice.salesman ?? "no salesman"}.` : null,
  });
}
