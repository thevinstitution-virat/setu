import { engageRead, engageWrite, myShop } from "@/lib/engage-api";
import { rateDelivery } from "@/lib/tickets";
import { supportSettings } from "@/lib/engage-settings";

/** GET → my delivered orders still waiting for a rating (newest first), and the rating window. */
export async function GET() {
  return engageRead("orders.place", async (ctx, s) => {
    const retailerId = await myShop(ctx.tx, s);
    const t = await ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
    const days = supportSettings(t?.settings).feedbackDays;
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const orders = await ctx.tx.order.findMany({
      where: { retailerId, status: "DELIVERED", feedback: null, OR: [{ delivery: { deliveredAt: { gte: since } } }, { delivery: null, updatedAt: { gte: since } }] },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, orderNumber: true, totalAmount: true, delivery: { select: { deliveredAt: true, deliveryAgent: { select: { user: { select: { name: true } } } } } } },
    });
    return {
      days,
      items: orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber, totalAmount: o.totalAmount, deliveredAt: o.delivery?.deliveredAt ?? null, driver: o.delivery?.deliveryAgent.user.name ?? null })),
    };
  });
}

/** Body: { orderId, rating 1-5, tags?: string[], comment? } */
export async function POST(req: Request) {
  return engageWrite(req, "feedback.give", "orders.place", async (ctx, b, s) => rateDelivery(ctx, await myShop(ctx.tx, s), b as never), {
    entity: "DeliveryFeedback",
    status: 201,
  });
}
