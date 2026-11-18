import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { quoteCart, retailerPricingCtx } from "@/lib/pricing";
import { cartRetailer, parseCartBody } from "@/lib/cart-api";

/**
 * Price a cart for a retailer: rates, schemes, free goods, delivery charge,
 * GST, minimum order and delivery days. Body: { retailerId?, items:
 * [{ productId, quantity } | { productId, cases }], coupon?, deliveryDate? }.
 * Same code as order placement, so the total here is the total billed.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = parseCartBody(await req.json().catch(() => null));
  const who = await cartRetailer(db, session, body.retailerId, "view");
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

  const quote = await withTenantTx(tenant.id, async (tx) => {
    const r = await retailerPricingCtx(tx, who.retailerId);
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } });
    return quoteCart(tx, t.settings, r!, body);
  });
  return NextResponse.json({ quote });
}
