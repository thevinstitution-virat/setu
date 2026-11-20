import { engageRead, engageWrite } from "@/lib/engage-api";
import { officeReply, overdue } from "@/lib/tickets";
import { staffWith } from "@/lib/notify";
import { MoneyError } from "@/lib/money-error";

/** GET → one complaint with every message (internal notes too), the order, the shop and who can be assigned. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageRead("tickets.manage", async (ctx) => {
    const t = await ctx.tx.ticket.findUnique({
      where: { id },
      include: {
        retailer: { select: { id: true, outletName: true, user: { select: { phone: true, name: true } }, area: { select: { name: true } } } },
        order: { select: { id: true, orderNumber: true, totalAmount: true, status: true, createdAt: true, items: { select: { id: true, quantity: true, product: { select: { name: true } } } } } },
        assignedTo: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, role: true } },
        messages: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, photoKeys: true, internal: true, change: true, createdAt: true, author: { select: { id: true, name: true, role: true } } } },
      },
    });
    if (!t) throw new MoneyError("Complaint not found", 404);
    const staffIds = await staffWith(ctx.tx, "tickets.manage");
    const staff = await ctx.tx.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    const feedback = t.orderId ? await ctx.tx.deliveryFeedback.findUnique({ where: { orderId: t.orderId }, select: { rating: true, tags: true, comment: true } }) : null;
    return { ticket: { ...t, overdue: overdue(t) }, staff, feedback };
  });
}

/** Body: { body?, internal?, status?, assignedToId?, priority?, photoKeys? } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageWrite(req, "ticket.update", "tickets.manage", (ctx, b, s) => officeReply(ctx, s.userId, id, b), { entity: "Ticket", entityId: id });
}
