import { stockMutation } from "@/lib/stock-api";
import { fieldRead, qp } from "@/lib/field-api";
import { saveTarget, targetProgress, teamScope } from "@/lib/field";
import { istMonth } from "@/lib/field-math";
import { can } from "@/lib/permissions";

/**
 * GET ?period=YYYY-MM[&mine=1] → targets with achievement, % and incentive
 * earned. Field staff see their own; supervisors their team's; admins all.
 */
export async function GET(req: Request) {
  const sp = qp(req);
  return fieldRead([], async (ctx, who) => {
    const mine = sp.get("mine") === "1";
    const scope = mine ? [who.userId] : await teamScope(ctx.tx, who);
    return { period: sp.get("period") || istMonth(), targets: await targetProgress(ctx.tx, scope, sp.get("period") || istMonth()), canManage: can(who.role, "targets.manage") };
  });
}

/** Body: { userId, period, metric, goal, productId?, brandId?, incentive (paise), minPct?, capPct?, note? } */
export async function POST(req: Request) {
  return stockMutation(req, "target.save", (ctx, b) => saveTarget(ctx, b), { perm: "targets.manage", entity: "Target" });
}
