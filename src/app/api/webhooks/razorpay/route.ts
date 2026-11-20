import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { handleRazorpayWebhook } from "@/lib/gateway";

/**
 * Razorpay calls this on the business's own address
 * (https://<business>.<domain>/api/webhooks/razorpay). The raw body is
 * checked against X-Razorpay-Signature with the business's webhook secret.
 */
export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 512 * 1024) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const r = await handleRazorpayWebhook(tenant.id, raw, req.headers.get("x-razorpay-signature"), req.headers.get("x-razorpay-event-id"));
  return NextResponse.json(r.body, { status: r.http });
}
