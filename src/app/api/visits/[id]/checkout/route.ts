import { stockMutation, optStr } from "@/lib/stock-api";
import { optNum } from "@/lib/field-api";
import { endVisit } from "@/lib/field";

/** Body: { reason? (needed when no order was placed on the visit), note?, lat?, lng? } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stockMutation(
    req,
    "visit.end",
    (ctx, b) => endVisit(ctx, { userId: ctx.actorId!, role: "SALES_AGENT" }, id, { reason: b.reason, note: optStr(b.note ?? b.notes, 500), lat: optNum(b.lat), lng: optNum(b.lng) }),
    { perm: "field.work", entity: "Visit", entityId: id }
  );
}
