import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { cancelPurchase, purchaseDetail } from "@/lib/purchases";

/** GET: one bill or note. POST { action: "cancel", reason }: cancel it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  try {
    const doc = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => purchaseDetail(ctx, id));
    return NextResponse.json({ doc }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("purchases.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as { action?: string; reason?: string };
  if (b.action !== "cancel") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  try {
    await withMoney(auth.tenant.id, auth.session.userId, (ctx) => cancelPurchase(ctx, id, String(b.reason ?? "")));
    await audit(auth.db, { actorId: auth.session.userId, action: "purchase.cancel", entity: "PurchaseBill", entityId: id, after: { reason: b.reason }, ip: requestIp(req) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return moneyFail(e);
  }
}
