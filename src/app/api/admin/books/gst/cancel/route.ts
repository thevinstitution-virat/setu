import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { cancelGstSettlement } from "@/lib/gst-returns";

/** POST { id, reason }: cancel the latest month's GST settlement (its entry is reversed). */
export async function POST(req: Request) {
  const auth = await guard("accounts.post");
  if (!auth.ok) return auth.res;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => cancelGstSettlement(ctx, String(b.id ?? ""), String(b.reason ?? "")));
    await audit(auth.db, { actorId: auth.session.userId, action: "gst.cancel", entity: "GstSettlement", entityId: r.id, after: { period: r.period, reason: b.reason }, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}
