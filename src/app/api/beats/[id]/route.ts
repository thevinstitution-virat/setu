import { stockMutation } from "@/lib/stock-api";
import { assertAgentInScope, saveBeat } from "@/lib/field";
import { MoneyError } from "@/lib/money-error";

/** Body: same as POST /api/beats; send all fields (name, salesAgentId, areaId, weekdays, retailerIds, active?). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stockMutation(
    req,
    "beat.update",
    async (ctx, b) => {
      const beat = await ctx.tx.beat.findUnique({ where: { id }, select: { salesAgentId: true } });
      if (!beat) throw new MoneyError("Beat not found", 404);
      await assertAgentInScope(ctx, beat.salesAgentId);
      await assertAgentInScope(ctx, b.salesAgentId);
      return saveBeat(ctx, id, b);
    },
    { perm: "team.supervise", entity: "Beat", entityId: id }
  );
}
