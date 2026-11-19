import { NextResponse } from "next/server";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { attachPayLink, BillingError, markInvoicePaid, voidInvoice } from "@/lib/billing";
import { asPlatform } from "@/lib/db";

/** Body: { action: "paid", ref, via? } | { action: "void", reason } | { action: "link" } (make a payment link). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/platform/invoices/[id]">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  try {
    let inv;
    if (body?.action === "paid") {
      const ref = String(body.ref ?? "").trim();
      if (!ref) return NextResponse.json({ error: "Enter the payment reference (UTR / UPI ref)" }, { status: 400 });
      inv = await markInvoicePaid(id, { ref, via: String(body.via ?? "bank transfer") });
    } else if (body?.action === "void") {
      if (g.session.role !== "OWNER") return NextResponse.json({ error: "Only the platform owner can void invoices" }, { status: 403 });
      inv = await voidInvoice(id, String(body.reason ?? ""));
    } else if (body?.action === "link") {
      const cur = await asPlatform((tx) => tx.platformInvoice.findUnique({ where: { id } }));
      if (!cur) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
      inv = await attachPayLink(cur);
      if (!inv.payUrl) return NextResponse.json({ error: "No payment link: set PLATFORM_RAZORPAY_KEY_ID / _SECRET, or the gateway refused" }, { status: 400 });
    } else {
      return NextResponse.json({ error: "action is paid, void or link" }, { status: 400 });
    }
    await platformAudit(g.session.platformUserId, `invoice.${body.action}`, { tenantId: inv.tenantId, detail: { invoice: inv.number, ref: body.ref ?? null, reason: body.reason ?? null }, ip: requestIp(req) });
    return NextResponse.json(inv);
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
