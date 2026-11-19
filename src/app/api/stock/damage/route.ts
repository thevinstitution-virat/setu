import { damageStock } from "@/lib/stock";
import { int, optStr, str, stockMutation } from "@/lib/stock-api";

/** Move damaged / expired goods to the damaged bin. Body: { locationId, productId, qty, reason (DAMAGE_REASONS), lotId?, note? } */
export async function POST(req: Request) {
  return stockMutation(req, "stock.damage", async (ctx, b) => {
    const picks = await damageStock(ctx, { locationId: str(b.locationId), productId: str(b.productId), qty: int(b.qty), reason: str(b.reason, 30), lotId: optStr(b.lotId), note: optStr(b.note, 300) });
    return { moved: picks.reduce((a, p) => a + p.qty, 0) };
  });
}
