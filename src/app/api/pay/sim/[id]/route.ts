import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { moneyFail } from "@/lib/money-api";
import { simulatePay } from "@/lib/gateway";

type P = { params: Promise<{ id: string }> };

/** The practice gateway's payment page data (provider simulator only; no sign-in, like a real link). */
export async function GET(_req: Request, { params }: P) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const { id } = await params;
  const i = await tenantDb(tenant.id).paymentIntent.findUnique({ where: { id }, include: { retailer: { select: { outletName: true } } } });
  if (!i || i.provider !== "simulator") return NextResponse.json({ error: "Payment request not found" }, { status: 404 });
  return NextResponse.json({ id: i.id, business: tenant.name, outletName: i.retailer.outletName, amount: i.amount, paidAmount: i.paidAmount, status: i.status, expiresAt: i.expiresAt, kind: i.kind });
}

/** Body: { amount? } paise; empty pays everything left. */
export async function POST(req: Request, { params }: P) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { amount?: unknown } | null;
  const amount = body?.amount === undefined || body?.amount === null ? null : Number(body.amount);
  try {
    const result = await simulatePay(tenant.id, id, amount);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return moneyFail(e);
  }
}
