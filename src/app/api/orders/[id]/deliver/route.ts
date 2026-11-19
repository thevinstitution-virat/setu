import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { keyBelongsTo } from "@/lib/storage";
import { can } from "@/lib/permissions";
import { MoneyError, onOrderDelivered, withMoney } from "@/lib/ledger";
import { moneyFail, parseCollect } from "@/lib/money-api";
import { queueEInvoice } from "@/lib/einvoice-queue";

/**
 * Mark an order delivered. Books the sale and its bill, settles a prepaid
 * order from its wallet reservation, and records anything collected on the
 * spot — all in one transaction.
 *
 * Body: { podPhotoKey?, podSignatureKey?, lat?, lng?,
 *         collect?: { amount (paise), method: CASH|UPI|CHEQUE, reference?, cheque?, proofKey? } }
 * Legacy body { paymentMethod: "CASH" } (no collect) = full order total in cash.
 *
 * The assigned delivery agent can deliver; staff with orders.manage can also
 * deliver from the office (counter pickup), and their cash goes to office cash.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(["delivery.work"]);
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;

  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
  const office = !agent && can(session.role, "orders.manage");
  const delivery = await db.delivery.findUnique({ where: { orderId: id } });
  if (!office && (!agent || !delivery || delivery.deliveryAgentId !== agent.id)) {
    return NextResponse.json({ error: "This order is not assigned to you" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const lat = typeof body?.lat === "number" ? body.lat : null;
  const lng = typeof body?.lng === "number" ? body.lng : null;
  const keyOrNull = (v: unknown) => (typeof v === "string" && keyBelongsTo(v, tenant.id) ? v : null);
  const podPhotoUrl = keyOrNull(body?.podPhotoKey);
  const podSignatureData = keyOrNull(body?.podSignatureKey);

  const order0 = await db.order.findUnique({ where: { id } });
  if (!order0 || order0.status === "DELIVERED" || order0.status === "CANCELLED") {
    return NextResponse.json({ error: "This order can no longer be delivered" }, { status: 400 });
  }
  if (order0.creditHold && !order0.creditApprovedAt) {
    return NextResponse.json({ error: `On credit hold: ${order0.creditHoldReason ?? "needs approval"}` }, { status: 409 });
  }

  // What was collected. Amounts are decided by what the agent enters (or, for
  // the legacy body, the server's order total) — never a client-sent total.
  let collect: Exclude<ReturnType<typeof parseCollect>, string> | null = null;
  if (body?.collect) {
    const parsed = parseCollect(body.collect, tenant.id);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    collect = parsed;
  } else if (body?.paymentMethod === "CASH" && order0.walletHold === 0) {
    collect = { amount: order0.totalAmount, method: "CASH", reference: null, proofKey: null, note: null, cheque: null };
  }

  const cashAmount = collect?.method === "CASH" ? collect.amount : 0;
  const deliveryPaymentMethod = !collect ? "CREDIT" : collect.method === "CASH" ? "CASH" : "ONLINE";

  let out;
  try {
    out = await withMoney(tenant.id, session.userId, async (ctx) => {
      const fresh = await ctx.tx.order.findUniqueOrThrow({ where: { id } });
      if (fresh.status === "DELIVERED" || fresh.status === "CANCELLED") {
        throw new MoneyError("This order can no longer be delivered");
      }
      const deliveryData = {
        deliveredAt: new Date(),
        podPhotoUrl,
        podSignatureData,
        paymentMethod: deliveryPaymentMethod,
        paymentStatus: collect ? "COLLECTED" : "PENDING",
        codAmount: cashAmount,
        lat,
        lng,
      } as const;
      if (delivery) {
        await ctx.tx.delivery.update({ where: { orderId: id }, data: deliveryData });
      } else if (agent) {
        await ctx.tx.delivery.create({ data: { orderId: id, deliveryAgentId: agent.id, ...deliveryData } });
      }
      const order = await ctx.tx.order.update({
        where: { id },
        data: {
          status: "DELIVERED",
          statusEvents: {
            create: {
              status: "DELIVERED",
              actorId: session.userId,
              note: office ? "Delivered at the office" : "Delivered with proof of delivery",
            },
          },
        },
      });
      const { payment, invoice } = await onOrderDelivered(
        ctx,
        fresh,
        collect ? { ...collect, collectorId: session.userId, atOffice: office } : null
      );
      return { order, payment, invoice };
    });
  } catch (e) {
    return moneyFail(e);
  }

  await audit(db, {
    actorId: session.userId,
    action: "order.deliver",
    entity: "Order",
    entityId: id,
    before: { status: order0.status },
    after: { status: "DELIVERED", collected: collect?.amount ?? 0, method: collect?.method ?? null, paymentId: out.payment?.id ?? null, lat, lng },
    ip: requestIp(req),
  });
  await emit("order.delivered", { tenantId: tenant.id, orderId: id, paymentMethod: deliveryPaymentMethod, codAmount: cashAmount });
  if (out.invoice) await queueEInvoice(tenant.id, out.invoice);

  return NextResponse.json(out);
}
