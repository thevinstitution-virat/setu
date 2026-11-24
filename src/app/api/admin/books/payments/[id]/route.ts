import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { cancelSupplierPayment, paymentDetail } from "@/lib/supplier-payments";

type P = { params: Promise<{ id: string }> };

/** GET: one payment to a supplier. */
export async function GET(_req: Request, { params }: P) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  try {
    const payment = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => paymentDetail(ctx, id));
    return NextResponse.json({ payment }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}

/** POST { action: "cancel" | "bounce", reason }: undo it (entered by mistake, or our cheque bounced / was stopped). */
export async function POST(req: Request, { params }: P) {
  const auth = await guard("payables.pay");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as {
    action?: string;
    reason?: string;
  };
  if (b.action !== "cancel" && b.action !== "bounce") return NextResponse.json({ error: "Action is cancel or bounce" }, { status: 400 });
  try {
    await withMoney(auth.tenant.id, auth.session.userId, (ctx) => cancelSupplierPayment(ctx, id, String(b.reason ?? ""), b.action === "bounce" ? "BOUNCED" : "CANCELLED"));
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: `supplier.pay.${b.action}`,
      entity: "SupplierPayment",
      entityId: id,
      after: { reason: b.reason },
      ip: requestIp(req),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return moneyFail(e);
  }
}
