import { engageRead, engageWrite, myShop, qp } from "@/lib/engage-api";
import { raiseTicket, overdue } from "@/lib/tickets";
import { mayServeRetailer } from "@/lib/cart-api";
import { MoneyError } from "@/lib/money-error";
import { tenantDb } from "@/lib/db";

/** GET → my complaints: a shop sees its own; field staff see the ones they raised (?retailerId= for one shop). */
export async function GET(req: Request) {
  const sp = qp(req);
  return engageRead("tickets.raise", async (ctx, s) => {
    const where =
      s.role === "RETAILER"
        ? { retailerId: await myShop(ctx.tx, s) }
        : { createdById: s.userId, ...(sp.get("retailerId") ? { retailerId: sp.get("retailerId")! } : {}) };
    const rows = await ctx.tx.ticket.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        number: true,
        category: true,
        subject: true,
        status: true,
        slaDueAt: true,
        createdAt: true,
        updatedAt: true,
        retailer: { select: { outletName: true } },
        order: { select: { id: true, orderNumber: true } },
        _count: { select: { messages: { where: { internal: false } } } },
      },
    });
    return { items: rows.map((t) => ({ ...t, overdue: overdue(t) })) };
  });
}

/** Body: { retailerId? (staff only), orderId?, category, subject?, body, photoKeys? } */
export async function POST(req: Request) {
  return engageWrite(
    req,
    "ticket.raise",
    "tickets.raise",
    async (ctx, b, s) => {
      let retailerId: string;
      if (s.role === "RETAILER") retailerId = await myShop(ctx.tx, s);
      else {
        if (typeof b.retailerId !== "string") throw new MoneyError("Pick the shop");
        const shop = await ctx.tx.retailerProfile.findUnique({ where: { id: b.retailerId }, select: { id: true, salesAgentId: true } });
        if (!shop) throw new MoneyError("Shop not found", 404);
        if (s.role !== "ADMIN" && !(await mayServeRetailer(tenantDb(ctx.tenantId), s, shop.salesAgentId))) throw new MoneyError("This shop is not one you serve", 403);
        retailerId = shop.id;
      }
      return raiseTicket(ctx, s.userId, {
        retailerId,
        orderId: typeof b.orderId === "string" && b.orderId ? b.orderId : null,
        category: b.category,
        subject: b.subject,
        body: b.body,
        photoKeys: b.photoKeys,
      });
    },
    { entity: "Ticket", status: 201 }
  );
}
