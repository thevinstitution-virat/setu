import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { cancelIntent, syncIntent } from "@/lib/gateway";
import { canSeeIntent, intentView } from "@/lib/pay-requests-api";

type P = { params: Promise<{ id: string }> };

/** One request (screens poll this while a QR is on show). ?sync=1 also asks the gateway. */
export async function GET(req: Request, { params }: P) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const intent = await db.paymentIntent.findUnique({ where: { id }, include: { retailer: { select: { outletName: true } } } });
  if (!intent || !(await canSeeIntent(db, session, intent))) return NextResponse.json({ error: "Payment request not found" }, { status: 404 });
  const open = intent.status === "CREATED" || intent.status === "PARTIAL";
  if (open && new URL(req.url).searchParams.get("sync") === "1" && intent.provider === "razorpay") {
    try {
      const r = await syncIntent(tenant.id, id);
      return NextResponse.json(intentView({ ...r.intent, retailer: intent.retailer }));
    } catch {
      // A slow gateway should not break the screen; show what we know.
    }
  }
  return NextResponse.json(intentView(intent));
}

/** Body: { action: "cancel" | "sync" } */
export async function POST(req: Request, { params }: P) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const intent = await db.paymentIntent.findUnique({ where: { id }, include: { retailer: { select: { outletName: true } } } });
  if (!intent || !(await canSeeIntent(db, session, intent))) return NextResponse.json({ error: "Payment request not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  try {
    if (body?.action === "cancel") {
      const r = await cancelIntent(tenant.id, session.userId, id);
      await audit(db, { actorId: session.userId, action: "pay_request.cancel", entity: "PaymentIntent", entityId: id, ip: requestIp(req) });
      return NextResponse.json(intentView({ ...r, retailer: intent.retailer }));
    }
    if (body?.action === "sync") {
      const r = await syncIntent(tenant.id, id);
      return NextResponse.json({ ...intentView({ ...r.intent, retailer: intent.retailer }), recorded: r.recorded });
    }
    return NextResponse.json({ error: "Action is cancel or sync" }, { status: 400 });
  } catch (e) {
    return moneyFail(e);
  }
}
