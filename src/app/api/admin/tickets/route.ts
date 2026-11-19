import type { Prisma, TicketStatus } from "@/generated/prisma/client";
import { engageRead, qp } from "@/lib/engage-api";
import { overdue } from "@/lib/tickets";
import { isTicketCategory } from "@/lib/engage-settings";
import { staffWith } from "@/lib/notify";

const OPEN: TicketStatus[] = ["OPEN", "IN_PROGRESS", "WAITING"];

/**
 * GET ?view=open|overdue|mine|resolved|closed|all &category=&q= → the complaints
 * queue (open ones by SLA, soonest first), counts per view and who can be assigned.
 */
export async function GET(req: Request) {
  const sp = qp(req);
  return engageRead("tickets.manage", async (ctx, s) => {
    const now = new Date();
    const view = sp.get("view") ?? "open";
    const where: Prisma.TicketWhereInput = {};
    if (view === "open") where.status = { in: OPEN };
    else if (view === "overdue") Object.assign(where, { status: { in: OPEN }, slaDueAt: { lt: now } });
    else if (view === "mine") Object.assign(where, { status: { in: OPEN }, assignedToId: s.userId });
    else if (view === "resolved") where.status = "RESOLVED";
    else if (view === "closed") where.status = "CLOSED";
    const cat = sp.get("category");
    if (isTicketCategory(cat)) where.category = cat;
    const q = (sp.get("q") ?? "").trim().slice(0, 60);
    if (q) where.OR = [{ number: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }, { retailer: { outletName: { contains: q, mode: "insensitive" } } }];
    const openish = view === "open" || view === "overdue" || view === "mine";
    const [rows, open, late, mine, resolved, closed, staffIds] = await Promise.all([
      ctx.tx.ticket.findMany({
        where,
        orderBy: openish ? [{ slaDueAt: "asc" }] : [{ updatedAt: "desc" }],
        take: 200,
        select: {
          id: true,
          number: true,
          category: true,
          subject: true,
          status: true,
          priority: true,
          slaDueAt: true,
          firstResponseAt: true,
          createdAt: true,
          updatedAt: true,
          retailer: { select: { id: true, outletName: true, area: { select: { name: true } } } },
          order: { select: { id: true, orderNumber: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      ctx.tx.ticket.count({ where: { status: { in: OPEN } } }),
      ctx.tx.ticket.count({ where: { status: { in: OPEN }, slaDueAt: { lt: now } } }),
      ctx.tx.ticket.count({ where: { status: { in: OPEN }, assignedToId: s.userId } }),
      ctx.tx.ticket.count({ where: { status: "RESOLVED" } }),
      ctx.tx.ticket.count({ where: { status: "CLOSED" } }),
      staffWith(ctx.tx, "tickets.manage"),
    ]);
    const staff = await ctx.tx.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
    return { items: rows.map((t) => ({ ...t, overdue: overdue(t, now) })), counts: { open, overdue: late, mine, resolved, closed, all: open + resolved + closed }, staff };
  });
}
