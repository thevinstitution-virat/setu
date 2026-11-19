import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { emit } from "@/lib/jobs";
import { withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { cartRetailer, parseCartBody } from "@/lib/cart-api";
import { moneyFail } from "@/lib/money-api";

/** Never send password hashes or other account internals to the browser. */
const USER = { id: true, name: true, phone: true } as const;

export async function GET() {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db } = auth;

  let where = {};

  if (session.role === "RETAILER") {
    const profile = await db.retailerProfile.findUnique({ where: { userId: session.userId } });
    if (!profile) return NextResponse.json({ orders: [] });
    where = { retailerId: profile.id };
  } else if (session.role === "SALES_AGENT") {
    const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent) return NextResponse.json({ orders: [] });
    where = { retailer: { salesAgentId: agent.id } };
  } else if (session.role === "DELIVERY_AGENT") {
    const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent) return NextResponse.json({ orders: [] });
    where = { delivery: { deliveryAgentId: agent.id } };
  }

  const orders = await db.order.findMany({
    where,
    include: {
      retailer: { include: { user: { select: USER } } },
      items: { include: { product: true } },
      delivery: { omit: { code: session.role !== "RETAILER" }, include: { deliveryAgent: { include: { user: { select: USER } } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const auth = await guard("orders.place");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;

  const body = parseCartBody(await req.json().catch(() => null));
  if (!body.items.length) return NextResponse.json({ error: "Add at least one product" }, { status: 400 });
  const who = await cartRetailer(db, session, body.retailerId, "order");
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

  // Pricing, schemes, number, order, scheme budgets, visit link and the wallet
  // reservation / credit check commit together, or not at all (a prepaid
  // retailer short of balance gets a 402; a scheme that just ran out a 409).
  let order;
  try {
    ({ order } = await withMoney(tenant.id, session.userId, (ctx) =>
      placeOrder(ctx, {
        retailerId: who.retailerId,
        placedById: session.userId,
        items: body.items,
        coupon: body.coupon,
        deliveryDate: body.deliveryDate,
        notes: body.notes,
        visitId: body.visitId,
      })
    ));
  } catch (e) {
    return moneyFail(e);
  }

  await emit("order.placed", { tenantId: tenant.id, orderId: order.id, placedBy: session.userId });
  return NextResponse.json({ order });
}
