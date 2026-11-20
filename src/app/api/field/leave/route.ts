import { stockMutation, optStr } from "@/lib/stock-api";
import { fieldRead, qp } from "@/lib/field-api";
import { requestLeave, teamScope } from "@/lib/field";
import { can } from "@/lib/permissions";

/**
 * GET → my leave. GET ?team=1 → leave of my team (supervisors, admins),
 * ?status=PENDING to narrow.
 */
export async function GET(req: Request) {
  const sp = qp(req);
  return fieldRead([], async (ctx, who) => {
    const team = sp.get("team") === "1" && (can(who.role, "team.supervise") || can(who.role, "team.manage"));
    const scope = team ? await teamScope(ctx.tx, who) : [who.userId];
    const status = sp.get("status");
    const leave = await ctx.tx.leaveRequest.findMany({
      where: {
        ...(scope ? { userId: { in: team ? scope.filter((id) => id !== who.userId) : scope } } : { userId: { not: who.userId } }),
        ...(status === "PENDING" || status === "APPROVED" || status === "REJECTED" || status === "CANCELLED" ? { status } : {}),
      },
      include: { user: { select: { name: true, role: true } }, decidedBy: { select: { name: true } } },
      orderBy: [{ status: "asc" }, { fromDate: "desc" }],
      take: 200,
    });
    return { leave };
  });
}

/** Body: { fromDate, toDate, type, reason? } */
export async function POST(req: Request) {
  return stockMutation(req, "leave.request", (ctx, b) => requestLeave(ctx, ctx.actorId!, { fromDate: b.fromDate, toDate: b.toDate, type: b.type, reason: optStr(b.reason, 500) }), {
    perm: "attendance.mark",
    entity: "LeaveRequest",
    status: 201,
  });
}
