import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { optStr } from "@/lib/stock-api";
import { decideLeave } from "@/lib/field";

/** Body: { action: "approve" | "reject" | "cancel", note? } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const action = body?.action;
  if (action !== "approve" && action !== "reject" && action !== "cancel") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  try {
    const leave = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      decideLeave(ctx, { userId: auth.session.userId, role: auth.session.role }, id, action, optStr(body?.note, 300))
    );
    await audit(auth.db, { actorId: auth.session.userId, action: `leave.${action}`, entity: "LeaveRequest", entityId: id, after: body, ip: requestIp(req) });
    return NextResponse.json({ ok: true, result: leave });
  } catch (e) {
    return moneyFail(e);
  }
}
