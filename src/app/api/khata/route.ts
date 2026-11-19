import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney, statement } from "@/lib/ledger";
import { khataSummary } from "@/lib/khata";
import { parseRange } from "@/lib/money-api";

/** The signed-in retailer's own khata. ?from=YYYY-MM-DD&to=YYYY-MM-DD adds a statement. */
export async function GET(req: Request) {
  const auth = await guard("payments.report");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const profile = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
  if (!profile) return NextResponse.json({ error: "Retailer profile not found" }, { status: 404 });

  const range = parseRange(new URL(req.url).searchParams);
  const data = await withMoney(tenant.id, session.userId, async (ctx) => ({
    ...(await khataSummary(ctx, profile.id)),
    statement: range ? { ...range, ...(await statement(ctx, profile.id, range.from, range.to)) } : null,
  }));
  // A sale invoice's / debit note's bill carries the document number: link the two.
  const docs = data.openBills.length
    ? await db.invoice.findMany({ where: { retailerId: profile.id, number: { in: data.openBills.map((b) => b.number) } }, select: { id: true, number: true } })
    : [];
  const invoiceOf = new Map(docs.map((d) => [d.number, d.id]));
  return NextResponse.json({ ...data, openBills: data.openBills.map((b) => ({ ...b, invoiceId: invoiceOf.get(b.number) ?? null })) });
}
