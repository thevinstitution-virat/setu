import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { audit, requestIp } from "@/lib/audit";
import { reversePayment, tagPayment, verifyPayment, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";

/**
 * Body: { action: "verify" | "reject" | "reverse" | "tag", reason?, billIds? }
 * verify/reject a retailer-reported payment (payments.verify);
 * reverse a confirmed payment entered by mistake (ledger.adjust, reason required);
 * tag: put the receipt against the chosen bills, in order (ledger.adjust; [] = oldest first).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action as string;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 300) : "";

  const need = action === "reverse" || action === "tag" ? "ledger.adjust" : "payments.verify";
  if (!["verify", "reject", "reverse", "tag"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!can(session.role, need)) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  if (action !== "verify" && action !== "tag" && reason.length < 3) return NextResponse.json({ error: "Give a reason" }, { status: 400 });
  const billIds: string[] = Array.isArray(body?.billIds) ? body.billIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 50) : [];
  if (action === "tag" && !Array.isArray(body?.billIds)) return NextResponse.json({ error: "Send the bills to put this payment against" }, { status: 400 });

  try {
    await withMoney(tenant.id, session.userId, async (ctx) => {
      if (action === "tag") await tagPayment(ctx, id, billIds);
      else if (action === "reverse") await reversePayment(ctx, id, reason);
      else await verifyPayment(ctx, id, action === "verify", reason);
    });
  } catch (e) {
    return moneyFail(e);
  }
  const payment = await db.payment.findUnique({ where: { id } });
  await audit(db, { actorId: session.userId, action: `payment.${action}`, entity: "Payment", entityId: id, after: action === "tag" ? { billIds } : { state: payment?.state, reason }, ip: requestIp(req) });
  return NextResponse.json({ payment });
}
