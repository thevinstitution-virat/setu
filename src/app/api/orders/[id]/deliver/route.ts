import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { keyBelongsTo } from "@/lib/storage";
import { can } from "@/lib/permissions";
import { withMoney } from "@/lib/ledger";
import { moneyFail, parseCollect } from "@/lib/money-api";
import { queueEInvoice } from "@/lib/einvoice-queue";
import { deliverOrder, type LineInput, type ReturnableInput } from "@/lib/delivery";

/**
 * Mark an order delivered, line by line. Books the sale (or credits what
 * wasn't handed over when it was invoiced at dispatch), settles a prepaid
 * order from its wallet reservation, records crates given / taken and
 * anything collected on the spot — all in one transaction (lib/delivery.ts).
 *
 * Body: { podPhotoKey?, podSignatureKey?, lat?, lng?, accuracy?, code?,
 *         lines?: [{ itemId, quantity, reason? }]   (missing lines = delivered in full)
 *         returnables?: [{ returnableId, given, taken }],
 *         collect?: { amount (paise), method: CASH|UPI|CHEQUE, reference?, cheque?, proofKey? } }
 * Legacy body { paymentMethod: "CASH" } (no collect, no lines) = full order total in cash.
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
  const delivery = await db.delivery.findUnique({ where: { orderId: id }, include: { trip: { select: { status: true } } } });
  if (!office && (!agent || !delivery || delivery.deliveryAgentId !== agent.id)) {
    return NextResponse.json({ error: "This order is not assigned to you" }, { status: 403 });
  }
  if (!office && delivery?.trip && delivery.trip.status !== "STARTED") {
    return NextResponse.json({ error: delivery.trip.status === "PLANNED" ? "Start the trip first" : "This trip is closed" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const keyOrNull = (v: unknown) => (typeof v === "string" && keyBelongsTo(v, tenant.id) ? v : null);
  const pod = {
    photo: keyOrNull(body?.podPhotoKey),
    signature: keyOrNull(body?.podSignatureKey),
    lat: num(body?.lat),
    lng: num(body?.lng),
    accuracy: num(body?.accuracy),
  };
  const lines: LineInput[] | undefined = Array.isArray(body?.lines)
    ? body.lines.map((l: Record<string, unknown>) => ({
        itemId: String(l?.itemId ?? ""),
        quantity: Number(l?.quantity),
        reason: typeof l?.reason === "string" ? l.reason : null,
      }))
    : undefined;
  const returnables: ReturnableInput[] = Array.isArray(body?.returnables)
    ? body.returnables.map((r: Record<string, unknown>) => ({
        returnableId: String(r?.returnableId ?? ""),
        given: Number(r?.given ?? 0),
        taken: Number(r?.taken ?? 0),
      }))
    : [];

  const order0 = await db.order.findUnique({ where: { id }, select: { status: true, totalAmount: true, walletHold: true } });
  if (!order0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // What was collected. Amounts are what the agent enters (or, for the legacy
  // body, the server's order total) — never a client-sent total.
  let collect: Exclude<ReturnType<typeof parseCollect>, string> | null = null;
  if (body?.collect) {
    const parsed = parseCollect(body.collect, tenant.id);
    if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
    collect = parsed;
  } else if (body?.paymentMethod === "CASH" && order0.walletHold === 0 && !lines) {
    collect = { amount: order0.totalAmount, method: "CASH", reference: null, proofKey: null, note: null, cheque: null };
  }

  // The delivery code is 4 digits: stop guessing after a few wrong tries.
  const code = typeof body?.code === "string" ? body.code : null;
  if (code !== null && !office) {
    const wrong = await db.auditLog.count({
      where: { entity: "Order", entityId: id, action: "delivery.code_wrong", createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
    });
    if (wrong >= 5) {
      return NextResponse.json({ error: "Too many wrong codes. Call the office: they can deliver it from their side." }, { status: 429 });
    }
  }

  let out;
  try {
    out = await withMoney(tenant.id, session.userId, (ctx) =>
      deliverOrder(ctx, {
        orderId: id,
        agentId: agent?.id ?? null,
        office,
        lines,
        code,
        returnables,
        pod,
        collect: collect ? { ...collect, collectorId: session.userId, atOffice: office } : null,
      })
    );
  } catch (e) {
    if (code && e instanceof Error && /code is wrong/.test(e.message)) {
      await audit(db, { actorId: session.userId, action: "delivery.code_wrong", entity: "Order", entityId: id, ip: requestIp(req) });
    }
    return moneyFail(e);
  }

  const cashAmount = collect?.method === "CASH" ? collect.amount : 0;
  await audit(db, {
    actorId: session.userId,
    action: "order.deliver",
    entity: "Order",
    entityId: id,
    before: { status: order0.status, total: order0.totalAmount },
    after: {
      status: "DELIVERED",
      total: out.totalAmount,
      short: lines?.filter((l) => l.reason).map((l) => ({ itemId: l.itemId, quantity: l.quantity, reason: l.reason })) ?? [],
      creditNote: out.creditNote?.number ?? null,
      returnables,
      collected: collect?.amount ?? 0,
      method: collect?.method ?? null,
      paymentId: out.payment?.id ?? null,
      lat: pod.lat,
      lng: pod.lng,
    },
    ip: requestIp(req),
  });
  await emit("order.delivered", { tenantId: tenant.id, orderId: id, paymentMethod: collect?.method ?? "CREDIT", codAmount: cashAmount });
  if (out.invoice) await queueEInvoice(tenant.id, out.invoice);
  if (out.creditNote) await queueEInvoice(tenant.id, out.creditNote);

  return NextResponse.json({ order: out.order, payment: out.payment, invoice: out.invoice, creditNote: out.creditNote, total: out.totalAmount });
}
