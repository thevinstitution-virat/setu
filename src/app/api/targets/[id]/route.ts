import { stockMutation } from "@/lib/stock-api";
import { MoneyError } from "@/lib/money-error";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stockMutation(
    req,
    "target.delete",
    async (ctx) => {
      const res = await ctx.tx.target.deleteMany({ where: { id } });
      if (!res.count) throw new MoneyError("Target not found", 404);
      return { id };
    },
    { perm: "targets.manage", entity: "Target", entityId: id }
  );
}
