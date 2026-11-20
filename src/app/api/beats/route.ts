import { stockMutation } from "@/lib/stock-api";
import { fieldRead, qp } from "@/lib/field-api";
import { assertAgentInScope, saveBeat, teamScope } from "@/lib/field";

/** GET [?salesAgentId=] → beats of agents in my team (admins: all), with their shops in order. */
export async function GET(req: Request) {
  const agentId = qp(req).get("salesAgentId");
  return fieldRead("team.supervise", async (ctx, who) => {
    const scope = await teamScope(ctx.tx, who);
    const beats = await ctx.tx.beat.findMany({
      where: { ...(agentId ? { salesAgentId: agentId } : {}), ...(scope ? { salesAgent: { userId: { in: scope } } } : {}) },
      include: {
        area: { select: { id: true, name: true } },
        salesAgent: { select: { id: true, user: { select: { id: true, name: true } } } },
        shops: { orderBy: { seq: "asc" }, select: { seq: true, retailer: { select: { id: true, outletName: true, pinCode: true } } } },
      },
      orderBy: [{ salesAgent: { user: { name: "asc" } } }, { name: "asc" }],
    });
    return { beats };
  });
}

/** Body: { name, salesAgentId, areaId, weekdays: number[] (0 = Sunday), retailerIds: string[] in visiting order } */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "beat.create",
    async (ctx, b) => {
      await assertAgentInScope(ctx, b.salesAgentId);
      return saveBeat(ctx, null, b);
    },
    { perm: "team.supervise", entity: "Beat", status: 201 }
  );
}
