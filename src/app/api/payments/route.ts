import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { audit, requestIp } from "@/lib/audit";
import { recordPayment, withMoney } from "@/lib/ledger";
import { collectScope } from "@/lib/khata";
import { moneyFail, parseCollect, parseRange } from "@/lib/money-api";
import type { PaymentState, PayMethod, Prisma } from "@/generated/prisma/client";

/**
 * Payments list. Accounts staff see all (filters: state, method, collectedBy,
 * retailerId, from/to); field staff see what they collected.
 */
export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const sp = new URL(req.url).searchParams;

  const where: Prisma.PaymentWhereInput = {};
  if (can(session.role, "ledger.view")) {
    if (sp.get("collectedBy")) where.collectedById = sp.get("collectedBy")!;
    if (sp.get("retailerId")) where.retailerId = sp.get("retailerId")!;
  } else if (can(session.role, "payments.collect")) {
    where.collectedById = session.userId;
  } else {
    return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  }
  const state = sp.get("state") as PaymentState | null;
  if (state && ["PENDING_VERIFICATION", "CONFIRMED", "REJECTED", "REVERSED"].includes(state)) where.state = state;
  const method = sp.get("method") as PayMethod | null;
  if (method && ["CASH", "UPI", "CHEQUE", "BANK", "ONLINE", "WALLET", "CREDIT_NOTE"].includes(method)) where.method = method;
  const range = parseRange(sp);
  if (range) where.collectedAt = { gte: range.from, lte: range.to };

  const payments = await db.payment.findMany({
    where,
    orderBy: { collectedAt: "desc" },
    take: Math.min(Number(sp.get("take")) || 100, 500),
    include: {
      retailer: { select: { id: true, outletName: true, user: { select: { name: true, phone: true } } } },
      collectedBy: { select: { id: true, name: true, role: true } },
      cheque: true,
    },
  });
  const totals = await db.payment.groupBy({ by: ["method"], where: { ...where, state: "CONFIRMED" }, _sum: { amount: true } });
  return NextResponse.json({
    payments,
    totals: Object.fromEntries(totals.map((t) => [t.method, Number(t._sum.amount ?? 0)])),
  });
}

/**
 * Staff records money received from a retailer (cash, UPI, cheque, bank).
 * Body: { retailerId, amount (paise), method, purpose?: DUES|WALLET, reference?, cheque?, proofKey?, note?, orderId? }
 * Confirmed at once; cash goes to the collector's cash in hand (office cash for office staff).
 */
export async function POST(req: Request) {
  const auth = await guard("payments.collect");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const retailerId = typeof body?.retailerId === "string" ? body.retailerId : "";
  const scope = await collectScope(db, session, retailerId);
  if (!scope) return NextResponse.json({ error: "Retailer not found or not yours" }, { status: 404 });

  const parsed = parseCollect(body, tenant.id);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  const purpose = body?.purpose === "WALLET" ? "WALLET" : "DUES";
  let orderId: string | null = null;
  if (typeof body?.orderId === "string") {
    const o = await db.order.findUnique({ where: { id: body.orderId }, select: { id: true, retailerId: true } });
    if (!o || o.retailerId !== retailerId) return NextResponse.json({ error: "Order not found for this retailer" }, { status: 400 });
    orderId = o.id;
  }

  let payment;
  try {
    payment = await withMoney(tenant.id, session.userId, (ctx) =>
      recordPayment(ctx, {
        ...parsed,
        retailerId,
        purpose,
        orderId,
        collectorId: session.userId,
        atOffice: scope.office,
      })
    );
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: "payment.collect",
    entity: "Payment",
    entityId: payment.id,
    after: { number: payment.number, retailerId, amount: payment.amount, method: payment.method, purpose },
    ip: requestIp(req),
  });
  return NextResponse.json({ payment });
}
