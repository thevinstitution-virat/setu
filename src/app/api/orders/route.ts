import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/tenant";
import { guard } from "@/lib/guard";
import { emit } from "@/lib/jobs";
import { nextOrderNumber, priceBreakup } from "@/lib/orders";
import { onOrderPlaced, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";

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
      retailer: { include: { user: true } },
      items: { include: { product: true } },
      delivery: { include: { deliveryAgent: { include: { user: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ orders });
}

export async function POST(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db } = auth;

  const body = await req.json().catch(() => null);
  const items: { productId: string; quantity: number }[] = body?.items ?? [];
  let retailerId: string | undefined = body?.retailerId;
  const notes: string | undefined = body?.notes;
  const visitId: string | undefined = body?.visitId;

  if (!items.length) {
    return NextResponse.json({ error: "Add at least one product" }, { status: 400 });
  }

  if (session.role === "RETAILER") {
    const profile = await db.retailerProfile.findUnique({ where: { userId: session.userId } });
    if (!profile) return NextResponse.json({ error: "Retailer profile not found" }, { status: 404 });
    retailerId = profile.id;
  } else if (session.role === "SALES_AGENT") {
    if (!retailerId) {
      return NextResponse.json({ error: "retailerId is required" }, { status: 400 });
    }
    const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    const retailer = await db.retailerProfile.findUnique({ where: { id: retailerId } });
    if (!agent || !retailer || retailer.salesAgentId !== agent.id) {
      return NextResponse.json({ error: "Retailer not assigned to you" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Not permitted to place orders" }, { status: 403 });
  }

  if (items.some((i) => !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 100000)) {
    return NextResponse.json({ error: "Quantities must be whole numbers of at least 1" }, { status: 400 });
  }

  const products = await db.product.findMany({
    where: { id: { in: items.map((i) => i.productId) }, active: true },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));
  if (items.some((i) => !productMap.has(i.productId))) {
    return NextResponse.json({ error: "Some products are no longer available" }, { status: 400 });
  }

  const lines = items.map((i) => {
    const product = productMap.get(i.productId)!;
    return { productId: i.productId, quantity: i.quantity, price: product.price, gstRate: product.gstRate };
  });
  const { subtotal, gstAmount, totalAmount } = priceBreakup(lines);

  const tenant = await requireTenant();
  // Number + order + visit link + wallet reservation / credit check commit
  // together, or not at all (a prepaid retailer short of balance gets a 402).
  let order;
  try {
    order = await withMoney(tenant.id, session.userId, async (ctx) => {
      const { tx } = ctx;
      const created = await tx.order.create({
        data: {
          orderNumber: await nextOrderNumber(tx, tenant.id),
          retailerId: retailerId!,
          placedById: session.userId,
          subtotal,
          gstAmount,
          totalAmount,
          notes,
          items: { create: lines },
          statusEvents: { create: { status: "PLACED", actorId: session.userId } },
        },
        include: { items: true },
      });
      if (visitId) {
        await tx.visit.updateMany({ where: { id: visitId, orderId: null }, data: { orderId: created.id } });
      }
      const credit = await onOrderPlaced(ctx, created);
      return { ...created, creditHold: credit.hold, creditHoldReason: credit.reason };
    });
  } catch (e) {
    return moneyFail(e);
  }

  await emit("order.placed", { tenantId: tenant.id, orderId: order.id, placedBy: session.userId });

  return NextResponse.json({ order });
}
