import { fieldRead, qp } from "@/lib/field-api";
import { leaderboard, teamScope } from "@/lib/field";
import { istMonth } from "@/lib/field-math";
import { MoneyError } from "@/lib/money-error";
import type { TargetMetric } from "@/generated/prisma/client";

const METRICS = new Set(["VALUE", "VOLUME", "NEW_OUTLETS", "COLLECTION"]);

/**
 * GET ?period=&metric= → ranking. Supervisors and admins rank their team;
 * field staff see the whole field force's ranking (names and totals only).
 */
export async function GET(req: Request) {
  const sp = qp(req);
  return fieldRead("attendance.mark", async (ctx, who) => {
    const metric = sp.get("metric") || "VALUE";
    if (!METRICS.has(metric)) throw new MoneyError("Pick what to rank by");
    const scope = who.role === "SUPERVISOR" ? await teamScope(ctx.tx, who) : null;
    const period = sp.get("period") || istMonth();
    const rows = await leaderboard(ctx.tx, scope, period, metric as TargetMetric);
    return { period, metric, rows, me: who.userId };
  });
}
