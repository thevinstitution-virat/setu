import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { audit, requestIp } from "@/lib/audit";
import { reversePayment, verifyPayment, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";

/**
 * Body: { action: "verify" | "reject" | "reverse", reason? }
 * verify/reject a retailer-reported payment (payments.verify);
 * reverse a confirmed payment entered by mistake (ledger.adjust, reason required).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action as string;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  const need = action === "reverse" ? "ledger.adjust" : "payments.verify";
  if (!["verify", "reject", "reverse"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!can(session.role, need)) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  if (action !== "verify" && reason.length < 3) return NextResponse.json({ error: "Give a reason" }, { status: 400 });

  try {
    await withMoney(tenant.id, session.userId, async (ctx) => {
      if (action === "reverse") await reversePayment(ctx, id, reason);
      else await verifyPayment(ctx, id, action === "verify", reason);
    });
  } catch (e) {
    return moneyFail(e);
  }
  const payment = await db.payment.findUnique({ where: { id } });
  await audit(db, { actorId: session.userId, action: `payment.${action}`, entity: "Payment", entityId: id, after: { state: payment?.state, reason }, ip: requestIp(req) });
  return NextResponse.json({ payment });
}
