import { fieldRead, qp } from "@/lib/field-api";
import { dayRoute, inScope, teamScope } from "@/lib/field";
import { MoneyError } from "@/lib/money-error";
import { isDay, istDay } from "@/lib/field-math";

/**
 * GET ?date=YYYY-MM-DD[&salesAgentId=] → the day's beat: shops in order with
 * that day's visit, off-route visits and coverage. Default: me, today.
 */
export async function GET(req: Request) {
  const sp = qp(req);
  return fieldRead("attendance.mark", async (ctx, who) => {
    const date = sp.get("date") || istDay();
    if (!isDay(date)) throw new MoneyError("Pick a day");
    const asked = sp.get("salesAgentId");
    const agent = asked
      ? await ctx.tx.salesAgentProfile.findUnique({ where: { id: asked }, select: { id: true, userId: true } })
      : await ctx.tx.salesAgentProfile.findUnique({ where: { userId: who.userId }, select: { id: true, userId: true } });
    if (!agent) return { date, source: null, plan: null, beat: null, route: [], offRoute: [], planned: 0, covered: 0, ordered: 0 };
    if (agent.userId !== who.userId && !inScope(await teamScope(ctx.tx, who), agent.userId)) throw new MoneyError("Not in your team", 403);
    return dayRoute(ctx.tx, ctx.tenantId, agent.id, date);
  });
}
