import { NextResponse } from "next/server";
import { asPlatform } from "@/lib/db";
import { validWebhook } from "@/lib/razorpay";
import { markInvoicePaid } from "@/lib/billing";
import { platformAudit } from "@/lib/platform-auth";

/**
 * Webhook from OUR gateway account (subscription invoices), on the platform
 * address: PLATFORM_RAZORPAY_WEBHOOK_SECRET signs it. payment_link.paid with
 * notes.setu_platform_invoice marks that invoice paid.
 */
export async function POST(req: Request) {
  const secret = process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Not set up" }, { status: 404 });
  const raw = await req.text();
  if (!validWebhook(raw, req.headers.get("x-razorpay-signature"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  let ev: { event?: string; payload?: { payment_link?: { entity?: { id?: string; notes?: Record<string, string> } }; payment?: { entity?: { id?: string; amount?: number } } } };
  try {
    ev = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  if (ev.event !== "payment_link.paid") return NextResponse.json({ ok: true, ignored: ev.event ?? null });
  const link = ev.payload?.payment_link?.entity;
  const invoiceId = link?.notes?.setu_platform_invoice;
  if (!invoiceId) return NextResponse.json({ ok: true, ignored: "not ours" });
  const inv = await asPlatform((tx) => tx.platformInvoice.findUnique({ where: { id: invoiceId } }));
  if (!inv || inv.payLinkId !== link?.id) return NextResponse.json({ ok: true, ignored: "unknown invoice" });
  const paid = ev.payload?.payment?.entity;
  if (paid?.amount !== undefined && paid.amount < inv.total) return NextResponse.json({ ok: true, ignored: "short payment" });
  await markInvoicePaid(inv.id, { ref: paid?.id ?? link?.id ?? null, via: "razorpay" });
  await platformAudit(null, "invoice.paid_online", { tenantId: inv.tenantId, detail: { invoice: inv.number, payment: paid?.id ?? null } });
  return NextResponse.json({ ok: true });
}
