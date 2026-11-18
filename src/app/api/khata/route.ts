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
  return NextResponse.json(data);
}
