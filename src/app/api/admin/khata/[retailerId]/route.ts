import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { allocateRetailer, withMoney, statement } from "@/lib/ledger";
import { collectScope, khataSummary } from "@/lib/khata";
import { parseRange } from "@/lib/money-api";

type Params = { params: Promise<{ retailerId: string }> };

/** One retailer's khata. Staff who may collect from them can read it (agents see dues before collecting). */
export async function GET(req: Request, { params }: Params) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { retailerId } = await params;
  const scope = await collectScope(db, session, retailerId);
  if (!scope) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  // Field staff see dues before collecting, not the shop's full statement history.
  const range = scope.office ? (parseRange(sp) ?? { from: new Date(Date.now() - 90 * 86_400_000), to: new Date() }) : null;
  const data = await withMoney(tenant.id, session.userId, async (ctx) => ({
    ...(await khataSummary(ctx, retailerId)),
    statement: range ? { ...range, ...(await statement(ctx, retailerId, range.from, range.to)) } : null,
  }));
  return NextResponse.json(data);
}

/** Set this retailer's credit terms. null for a field = use the business default. */
export async function PATCH(req: Request, { params }: Params) {
  const auth = await guard("credit.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { retailerId } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Missing terms" }, { status: 400 });

  const data: {
    paymentMode?: "PREPAID" | "POSTPAID" | null;
    creditLimit?: number | null;
    creditDays?: number | null;
    creditBills?: number | null;
    tempCreditLimit?: number | null;
    tempCreditUntil?: Date | null;
    receiptsOnAccount?: boolean;
  } = {};
  if ("paymentMode" in body) {
    if (body.paymentMode !== null && body.paymentMode !== "PREPAID" && body.paymentMode !== "POSTPAID") {
      return NextResponse.json({ error: "Payment mode must be PREPAID, POSTPAID or default" }, { status: 400 });
    }
    data.paymentMode = body.paymentMode as typeof data.paymentMode;
  }
  const LABEL = { creditLimit: "Credit limit", creditDays: "Credit days", creditBills: "Unpaid bills allowed", tempCreditLimit: "Temporary limit" } as const;
  for (const [k, max] of [["creditLimit", 1_000_000_000], ["creditDays", 365], ["creditBills", 999], ["tempCreditLimit", 1_000_000_000]] as const) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null) {
      data[k] = null;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || n < (k === "creditBills" ? 1 : 0) || n > max) {
      return NextResponse.json({ error: `${LABEL[k]} must be ${k === "creditBills" ? "1" : "0"} or more` }, { status: 400 });
    }
    data[k] = n;
  }
  // A temporary limit needs its last day (YYYY-MM-DD, counted to the end of that day in India), today or later.
  if ("tempCreditUntil" in body) {
    const v = body.tempCreditUntil;
    if (v === null) data.tempCreditUntil = null;
    else {
      const until = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999+05:30`) : null;
      if (!until || Number.isNaN(until.getTime()) || until.getTime() < Date.now()) return NextResponse.json({ error: "The temporary limit's last day must be today or later" }, { status: 400 });
      data.tempCreditUntil = until;
    }
  }
  if (data.tempCreditLimit != null && data.tempCreditUntil == null) return NextResponse.json({ error: "Give the temporary limit a last day" }, { status: 400 });
  if (data.tempCreditLimit === null) data.tempCreditUntil = null;
  if ("receiptsOnAccount" in body) data.receiptsOnAccount = body.receiptsOnAccount === true;

  const before = await db.retailerProfile.findUnique({
    where: { id: retailerId },
    select: { paymentMode: true, creditLimit: true, creditDays: true, creditBills: true, tempCreditLimit: true, tempCreditUntil: true, receiptsOnAccount: true },
  });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const after = await db.retailerProfile.update({
    where: { id: retailerId },
    data,
    select: { paymentMode: true, creditLimit: true, creditDays: true, creditBills: true, tempCreditLimit: true, tempCreditUntil: true, receiptsOnAccount: true },
  });
  // Switched off: the receipts waiting on account go to the oldest bills now.
  if (before.receiptsOnAccount && !after.receiptsOnAccount) await withMoney(auth.tenant.id, session.userId, (ctx) => allocateRetailer(ctx, retailerId));
  await audit(db, { actorId: session.userId, action: "retailer.terms", entity: "RetailerProfile", entityId: retailerId, before, after, ip: requestIp(req) });
  return NextResponse.json({ terms: after });
}
