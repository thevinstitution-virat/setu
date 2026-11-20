import { stockMutation, optStr } from "@/lib/stock-api";
import { fieldRead, qp } from "@/lib/field-api";
import { proposeLead, teamScope, type LeadInput } from "@/lib/field";
import { can } from "@/lib/permissions";

/**
 * GET [?status=PENDING] → shops added from the field. Field staff see their
 * own; supervisors their team's; approvers (stores.approve) every one.
 */
export async function GET(req: Request) {
  const status = qp(req).get("status");
  return fieldRead([], async (ctx, who) => {
    const scope = can(who.role, "stores.approve") ? null : await teamScope(ctx.tx, who);
    if (scope && !can(who.role, "stores.propose") && !can(who.role, "team.supervise")) return { leads: [], canApprove: false };
    const leads = await ctx.tx.storeLead.findMany({
      where: {
        ...(scope ? { createdById: { in: scope } } : {}),
        ...(status === "PENDING" || status === "APPROVED" || status === "REJECTED" ? { status } : {}),
      },
      include: { area: { select: { name: true } }, createdBy: { select: { name: true } }, decidedBy: { select: { name: true } }, salesAgent: { select: { id: true, user: { select: { name: true } } } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    return { leads, canApprove: can(who.role, "stores.approve") };
  });
}

/** Body: { outletName, ownerName, phone, gstin?, fssai?, shopNumber, complexName, pinCode, areaId, lat?, lng?, accuracy?, photoKey?, note? } */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "lead.propose",
    async (ctx, b) => proposeLead(ctx, { userId: ctx.actorId!, role: "SALES_AGENT" }, { ...(b as LeadInput), photoKey: optStr(b.photoKey, 300) }),
    { perm: "stores.propose", entity: "StoreLead", status: 201 }
  );
}
