import { engageRead, engageWrite, myShop } from "@/lib/engage-api";
import { overdue, retailerReply } from "@/lib/tickets";
import { MoneyError } from "@/lib/money-error";

/** GET → one of my complaints with its messages (office-only notes are never included). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageRead("tickets.raise", async (ctx, s) => {
    const t = await ctx.tx.ticket.findUnique({
      where: { id },
      include: {
        retailer: { select: { outletName: true } },
        order: { select: { id: true, orderNumber: true, totalAmount: true, createdAt: true } },
        messages: {
          where: { internal: false },
          orderBy: { createdAt: "asc" },
          select: { id: true, body: true, photoKeys: true, change: true, createdAt: true, author: { select: { id: true, name: true, role: true } } },
        },
      },
    });
    const mine = t && (s.role === "RETAILER" ? t.retailerId === (await myShop(ctx.tx, s)) : t.createdById === s.userId);
    if (!t || !mine) throw new MoneyError("Complaint not found", 404);
    const { assignedToId: _a, slaNotifiedAt: _n, ...rest } = t;
    void [_a, _n];
    return { ticket: { ...rest, overdue: overdue(t), canReply: s.role === "RETAILER" && t.status !== "CLOSED" } };
  });
}

/** Body: { body, photoKeys?, reopen? } → the shop adds to its complaint (or reopens a resolved one). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return engageWrite(
    req,
    "ticket.reply",
    "tickets.raise",
    async (ctx, b, s) => retailerReply(ctx, s.userId, await myShop(ctx.tx, s), id, b),
    { entity: "Ticket", entityId: id }
  );
}
