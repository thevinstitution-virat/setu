import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { keyBelongsTo } from "@/lib/storage";
import { withMoney } from "@/lib/ledger";
import { moneyFail, parseCollect } from "@/lib/money-api";
import { parseCartBody } from "@/lib/cart-api";
import { queueEInvoice } from "@/lib/einvoice-queue";
import { spotSale } from "@/lib/spot-sale";
import type { ReturnableInput } from "@/lib/delivery";

/**
 * Spot sale from the van: places the order (same prices, schemes and credit
 * rules as any order), adds it as a stop on the driver's running trip and
 * delivers it at once, selling from the van — one transaction.
 *
 * Body: { retailerId, items: [{ productId, quantity } | { productId, cases }],
 *         collect?: { amount, method: CASH|UPI|CHEQUE, reference?, cheque?, proofKey? },
 *         returnables?: [{ returnableId, given, taken }],
 *         podPhotoKey?, podSignatureKey?, lat?, lng?, accuracy? }
 */
export async function POST(req: Request) {
  const auth = await guard(["stock.spot_sell", "delivery.work"]);
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
  if (!agent) return NextResponse.json({ error: "Only drivers make spot sales" }, { status: 403 });

  const raw = await req.json().catch(() => null);
  const cart = parseCartBody(raw);
  if (typeof cart.retailerId !== "string" || !cart.retailerId) return NextResponse.json({ error: "Pick the shop" }, { status: 400 });
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const keyOrNull = (v: unknown) => (typeof v === "string" && keyBelongsTo(v, tenant.id) ? v : null);
  let collect: Exclude<ReturnType<typeof parseCollect>, string> | null = null;
  if (raw?.collect) {
    const parsed = parseCollect(raw.collect, tenant.id);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    collect = parsed;
  }
  const returnables: ReturnableInput[] = Array.isArray(raw?.returnables)
    ? raw.returnables.map((r: Record<string, unknown>) => ({ returnableId: String(r?.returnableId ?? ""), given: Number(r?.given ?? 0), taken: Number(r?.taken ?? 0) }))
    : [];
  const pod = { photo: keyOrNull(raw?.podPhotoKey), signature: keyOrNull(raw?.podSignatureKey), lat: num(raw?.lat), lng: num(raw?.lng), accuracy: num(raw?.accuracy) };

  let out;
  try {
    out = await withMoney(tenant.id, session.userId, (ctx) =>
      spotSale(ctx, {
        agentId: agent.id,
        driverUserId: session.userId,
        retailerId: cart.retailerId as string,
        items: cart.items,
        returnables,
        pod,
        collect: collect ? { ...collect, collectorId: session.userId, atOffice: false } : null,
      })
    );
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: "order.spot_sale",
    entity: "Order",
    entityId: out.order.id,
    after: { orderNumber: out.order.orderNumber, tripId: out.tripId, total: out.totalAmount, collected: collect?.amount ?? 0, method: collect?.method ?? null, lat: pod.lat, lng: pod.lng },
    ip: requestIp(req),
  });
  await emit("order.placed", { tenantId: tenant.id, orderId: out.order.id });
  await emit("order.delivered", { tenantId: tenant.id, orderId: out.order.id, paymentMethod: collect?.method ?? "CREDIT", codAmount: collect?.method === "CASH" ? collect.amount : 0 });
  if (out.invoice) await queueEInvoice(tenant.id, out.invoice);
  return NextResponse.json({ order: out.order, invoice: out.invoice, payment: out.payment, total: out.totalAmount }, { status: 201 });
}
