import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { recordPayment, withMoney } from "@/lib/ledger";
import { moneyFail, parseCollect } from "@/lib/money-api";

/**
 * A retailer tells us they paid (UPI or bank transfer) — for dues or to top up
 * their wallet. It waits for staff to check the bank/UPI app and verify it.
 * Body: { amount (paise), method: UPI|BANK, reference (UTR), proofKey?, note?, purpose?: DUES|WALLET }
 */
export async function POST(req: Request) {
  const auth = await guard("payments.report");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const profile = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
  if (!profile) return NextResponse.json({ error: "Retailer profile not found" }, { status: 404 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const parsed = parseCollect(body, tenant.id, { methods: ["UPI", "BANK"] });
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  if (!parsed.reference) return NextResponse.json({ error: "Enter the payment reference number" }, { status: 400 });

  // Same UTR twice is almost always a double tap or a copy-paste mistake.
  const dup = await db.payment.findFirst({
    where: { reference: parsed.reference, state: { in: ["PENDING_VERIFICATION", "CONFIRMED"] } },
    select: { number: true },
  });
  if (dup) return NextResponse.json({ error: `This reference was already used (${dup.number})` }, { status: 409 });

  const purpose = body?.purpose === "WALLET" ? "WALLET" : "DUES";
  let payment;
  try {
    payment = await withMoney(tenant.id, session.userId, (ctx) =>
      recordPayment(ctx, { ...parsed, retailerId: profile.id, purpose, needsVerification: true, collectorId: null })
    );
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: "payment.report",
    entity: "Payment",
    entityId: payment.id,
    after: { number: payment.number, amount: payment.amount, method: payment.method, reference: payment.reference, purpose },
    ip: requestIp(req),
  });
  return NextResponse.json({ payment });
}
