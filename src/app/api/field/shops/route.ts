import { fieldRead, qp } from "@/lib/field-api";
import { fieldSettingsOf, fieldShops } from "@/lib/field";

/** GET ?q= → shops this person may visit / order for: their own first, any shop when off-beat is allowed. */
export async function GET(req: Request) {
  const q = qp(req).get("q") ?? "";
  // Staff only: a shop also holds orders.place, and must never list other shops (names, phones).
  return fieldRead("orders.place", async (ctx, who) =>
    who.role === "RETAILER" ? { shops: [] } : { shops: await fieldShops(ctx.tx, who, await fieldSettingsOf(ctx.tx, ctx.tenantId), q.slice(0, 60)) }
  );
}
