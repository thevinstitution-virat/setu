import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { parseCartBody } from "@/lib/cart-api";
import { quoteSpotSale } from "@/lib/spot-sale";

/**
 * Price a spot sale and check it against the van's free stock (nothing is
 * saved). Body: { retailerId, items: [{ productId, quantity } | { productId, cases }] }.
 * quote.problems includes "only N free in the van" lines.
 */
export async function POST(req: Request) {
  const auth = await guard(["stock.spot_sell", "delivery.work"]);
  if (!auth.ok) return auth.res;
  const agent = await auth.db.deliveryAgentProfile.findUnique({ where: { userId: auth.session.userId } });
  if (!agent) return NextResponse.json({ error: "Only drivers make spot sales" }, { status: 403 });
  const body = parseCartBody(await req.json().catch(() => null));
  if (typeof body.retailerId !== "string" || !body.retailerId) return NextResponse.json({ error: "Pick the shop" }, { status: 400 });
  try {
    const out = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => quoteSpotSale(ctx, agent.id, body.retailerId as string, body.items));
    return NextResponse.json({
      quote: out.quote,
      trip: out.trip,
      van: out.van.map((r) => ({ productId: r.productId, name: r.name, unit: r.unit, caseSize: r.caseSize, free: r.free })),
      over: out.over,
    });
  } catch (e) {
    return moneyFail(e);
  }
}
