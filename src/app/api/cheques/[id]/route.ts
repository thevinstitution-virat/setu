import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { chequeAction, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";

/** Body: { action: "deposit" | "clear" | "bounce", reason? } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("cheques.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action as "deposit" | "clear" | "bounce";
  if (!["deposit", "clear", "bounce"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 200) : undefined;

  try {
    await withMoney(tenant.id, session.userId, (ctx) => chequeAction(ctx, id, action, reason));
  } catch (e) {
    return moneyFail(e);
  }
  const cheque = await db.cheque.findUnique({ where: { id } });
  await audit(db, { actorId: session.userId, action: `cheque.${action}`, entity: "Cheque", entityId: id, after: { status: cheque?.status, reason }, ip: requestIp(req) });
  return NextResponse.json({ cheque });
}
