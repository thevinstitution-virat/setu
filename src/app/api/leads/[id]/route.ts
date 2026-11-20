import { stockMutation, optStr } from "@/lib/stock-api";
import { fieldRead } from "@/lib/field-api";
import { decideLead, leadClashes } from "@/lib/field";
import { MoneyError } from "@/lib/money-error";

/** GET → one proposal with what it clashes with (same phone / GSTIN). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return fieldRead("stores.approve", async (ctx) => {
    const lead = await ctx.tx.storeLead.findUnique({ where: { id }, include: { area: { select: { name: true } }, createdBy: { select: { name: true } }, salesAgent: { select: { id: true, user: { select: { name: true } } } } } });
    if (!lead) throw new MoneyError("Proposal not found", 404);
    return { lead, clashes: lead.status === "PENDING" ? await leadClashes(ctx.tx, lead.phone, lead.gstin, lead.id) : [] };
  });
}

/** Body: { approve: boolean, note? (needed to reject), salesAgentId? (assign the new shop; null = none) } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stockMutation(
    req,
    "lead.decide",
    (ctx, b) =>
      decideLead(ctx, ctx.actorId!, id, {
        approve: b.approve === true,
        note: optStr(b.note, 300),
        ...("salesAgentId" in b ? { salesAgentId: typeof b.salesAgentId === "string" && b.salesAgentId ? b.salesAgentId : null } : {}),
      }),
    { perm: "stores.approve", entity: "StoreLead", entityId: id }
  );
}
