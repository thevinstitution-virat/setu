import { stockMutation } from "@/lib/stock-api";
import { fieldRead, qp } from "@/lib/field-api";
import { assertAgentInScope, beatForDay, inScope, setBeatPlans, teamScope } from "@/lib/field";
import { MoneyError } from "@/lib/money-error";
import { daysBetween, daysInclusive, isDay } from "@/lib/field-math";

/** GET ?salesAgentId=&from=&to= → the beat for each day (dated plan, else the weekday beat). */
export async function GET(req: Request) {
  const sp = qp(req);
  return fieldRead("team.supervise", async (ctx, who) => {
    const salesAgentId = sp.get("salesAgentId") ?? "";
    const from = sp.get("from") ?? "";
    const to = sp.get("to") ?? "";
    if (!isDay(from) || !isDay(to) || to < from || daysInclusive(from, to) > 62) throw new MoneyError("Pick up to 62 days");
    const agent = await ctx.tx.salesAgentProfile.findUnique({ where: { id: salesAgentId }, select: { id: true, userId: true } });
    if (!agent) throw new MoneyError("Pick the sales agent");
    if (!inScope(await teamScope(ctx.tx, who), agent.userId)) throw new MoneyError("That agent is not in your team", 403);
    const days = [];
    for (const date of daysBetween(from, to)) {
      const d = await beatForDay(ctx.tx, ctx.tenantId, agent.id, date);
      days.push({ date, source: d.source, beat: d.beat ? { id: d.beat.id, name: d.beat.name } : null, note: d.plan?.note ?? null });
    }
    return { days };
  });
}

/**
 * Body: { salesAgentId, entries: [{ date, beatId | null, note? } | { date, clear: true }] }
 * beatId null = a day with no beat (meeting, training); clear = back to the weekday beat.
 */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "beat.plan",
    async (ctx, b) => {
      await assertAgentInScope(ctx, b.salesAgentId);
      const entries = Array.isArray(b.entries) ? (b.entries as { date: unknown; beatId?: string | null; clear?: boolean; note?: string | null }[]) : [];
      return setBeatPlans(ctx, b.salesAgentId as string, entries);
    },
    { perm: "team.supervise", entity: "BeatPlan" }
  );
}
