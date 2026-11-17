import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { generateOrderNumber, priceBreakup } from "@/lib/orders";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let where = {};

  if (session.role === "RETAILER") {
    const profile = await prisma.retailerProfile.findUnique({ where: { userId: session.userId } });
    if (!profile) return NextResponse.json({ orders: [] });
    where = { retailerId: profile.id };
  } else if (session.role === "SALES_AGENT") {
    const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent) return NextResponse.json({ orders: [] });
    where = { retailer: { salesAgentId: agent.id } };
  } else if (session.role === "DELIVERY_AGENT") {
    const agent = await prisma.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent) return NextResponse.json({ orders: [] });
    where = { delivery: { deliveryAgentId: agent.id } };
  }

  const orders = await prisma.order.findMany({
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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const items: { productId: string; quantity: number }[] = body?.items ?? [];
  let retailerId: string | undefined = body?.retailerId;
  const notes: string | undefined = body?.notes;
  const visitId: string | undefined = body?.visitId;

  if (!items.length) {
    return NextResponse.json({ error: "Add at least one product" }, { status: 400 });
  }

  if (session.role === "RETAILER") {
    const profile = await prisma.retailerProfile.findUnique({ where: { userId: session.userId } });
    if (!profile) return NextResponse.json({ error: "Retailer profile not found" }, { status: 404 });
    retailerId = profile.id;
  } else if (session.role === "SALES_AGENT") {
    if (!retailerId) {
      return NextResponse.json({ error: "retailerId is required" }, { status: 400 });
    }
    const agent = await prisma.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    const retailer = await prisma.retailerProfile.findUnique({ where: { id: retailerId } });
    if (!agent || !retailer || retailer.salesAgentId !== agent.id) {
      return NextResponse.json({ error: "Retailer not assigned to you" }, { status: 403 });
    }
  } else {
    return NextResponse.json({ error: "Not permitted to place orders" }, { status: 403 });
  }

  const products = await prisma.product.findMany({
    where: { id: { in: items.map((i) => i.productId) } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const lines = items.map((i) => {
    const product = productMap.get(i.productId);
    return { quantity: i.quantity, price: product?.price ?? 0, gstRate: product?.gstRate ?? 0 };
  });
  const { subtotal, gstAmount, totalAmount } = priceBreakup(lines);

  const order = await prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      retailerId: retailerId!,
      placedById: session.userId,
      subtotal,
      gstAmount,
      totalAmount,
      notes,
      items: {
        create: items.map((i) => {
          const product = productMap.get(i.productId);
          return {
            productId: i.productId,
            quantity: i.quantity,
            price: product?.price ?? 0,
            gstRate: product?.gstRate ?? 0,
          };
        }),
      },
      statusEvents: {
        create: { status: "PLACED", actorId: session.userId },
      },
    },
    include: { items: true },
  });

  if (visitId) {
    await prisma.visit.update({ where: { id: visitId }, data: { orderId: order.id } }).catch(() => {});
  }

  return NextResponse.json({ order });
}
