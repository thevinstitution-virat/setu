import { fieldRead, qp } from "@/lib/field-api";
import { teamDay, teamScope } from "@/lib/field";
import { istDay } from "@/lib/field-math";

/**
 * GET ?date= → the team's day: attendance, leave, last position, visits,
 * orders, collections, beat coverage, distance and exceptions.
 */
export async function GET(req: Request) {
  const date = qp(req).get("date") || istDay();
  return fieldRead("team.supervise", async (ctx, who) => teamDay(ctx.tx, ctx.tenantId, await teamScope(ctx.tx, who), date));
}
