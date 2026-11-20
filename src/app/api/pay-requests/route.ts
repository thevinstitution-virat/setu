import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { collectScope } from "@/lib/khata";
import { moneyFail } from "@/lib/money-api";
import { createIntent } from "@/lib/gateway";
import { gatewayOn, gatewaySettings } from "@/lib/gateway-settings";
import { intentView, requestScope } from "@/lib/pay-requests-api";
import type { IntentStatus, Prisma } from "@/generated/prisma/client";

const STATUSES: IntentStatus[] = ["CREATED", "PARTIAL", "PAID", "EXPIRED", "CANCELLED"];

/** Payment requests (links and QRs). ?status=&retailerId=&orderId=&take= */
export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const scope = await requestScope(db, session);
  if (!scope) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const where: Prisma.PaymentIntentWhereInput = { ...scope.where };
  const status = sp.get("status") as IntentStatus | null;
  if (status && STATUSES.includes(status)) where.status = status;
  if (sp.get("retailerId") && !scope.retailerId) where.retailerId = sp.get("retailerId")!;
  if (sp.get("orderId")) {
    where.orderId = sp.get("orderId")!;
    // Field staff serving this shop see every request for the order (e.g. a QR the office made).
    if (where.createdById) {
      const o = await db.order.findUnique({ where: { id: where.orderId }, select: { retailerId: true } });
      if (o && (await collectScope(db, session, o.retailerId))) delete where.createdById;
    }
  }
  const rows = await db.paymentIntent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Number(sp.get("take")) || 50, 200),
    include: { retailer: { select: { outletName: true } } },
  });
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } }));
  const g = gatewaySettings(t.settings);
  return NextResponse.json({ on: gatewayOn(g), provider: g.provider, retailerPay: g.retailerPay, requests: rows.map(intentView) });
}

/**
 * Make a payment link or a single-use QR.
 * Body: { retailerId? (staff), kind: LINK|QR, amount? (paise; empty = all dues / order due), purpose?: DUES|WALLET, orderId?, note? }
 * Retailers make links for their own shop (when the business allows it); staff for shops they serve.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const kind = body?.kind === "QR" ? "QR" : body?.kind === "LINK" || body?.kind === undefined ? "LINK" : null;
  if (!kind) return NextResponse.json({ error: "Kind is LINK or QR" }, { status: 400 });
  const amount = body?.amount === undefined || body?.amount === null || body?.amount === "" ? null : Number(body.amount);
  if (amount !== null && !Number.isInteger(amount)) return NextResponse.json({ error: "Amount must be whole paise" }, { status: 400 });

  let retailerId: string;
  if (session.role === "RETAILER") {
    const p = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (!p) return NextResponse.json({ error: "Retailer profile not found" }, { status: 404 });
    const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } }));
    if (!gatewaySettings(t.settings).retailerPay) return NextResponse.json({ error: "Paying online is not turned on" }, { status: 403 });
    if (kind !== "LINK") return NextResponse.json({ error: "Shops pay through a link" }, { status: 400 });
    retailerId = p.id;
  } else if (can(session.role, "payments.collect") || can(session.role, "ledger.view")) {
    retailerId = typeof body?.retailerId === "string" ? body.retailerId : "";
    if (!(await collectScope(db, session, retailerId))) return NextResponse.json({ error: "Shop not found or not yours" }, { status: 404 });
  } else {
    return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  }

  try {
    const intent = await createIntent(tenant.id, session.userId, {
      kind,
      retailerId,
      amount,
      purpose: body?.purpose === "WALLET" ? "WALLET" : "DUES",
      orderId: typeof body?.orderId === "string" ? body.orderId : null,
      note: typeof body?.note === "string" ? body.note : null,
    });
    await audit(db, { actorId: session.userId, action: "pay_request.create", entity: "PaymentIntent", entityId: intent.id, after: { kind, amount: intent.amount, retailerId, orderId: intent.orderId }, ip: requestIp(req) });
    return NextResponse.json(intentView(intent), { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
