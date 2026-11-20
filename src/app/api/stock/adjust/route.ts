import { adjustStock } from "@/lib/stock";
import { int, optStr, str } from "@/lib/stock-api";
import { stockMutation } from "@/lib/stock-api";

/**
 * Adjust stock by hand. Body: { locationId, productId, delta (+ / − base units),
 * reason (ADJUST_REASONS), note?, lotId? (a batch), batch?, expiry? (YYYY-MM-DD), unitCost? (paise) }.
 * + with no lotId adds to (or makes) the batch given; − with no lotId takes first expiry first.
 */
export async function POST(req: Request) {
  return stockMutation(req, "stock.adjust", (ctx, b) =>
    adjustStock(ctx, {
      locationId: str(b.locationId),
      productId: str(b.productId),
      delta: int(b.delta),
      reason: str(b.reason, 30),
      note: optStr(b.note, 300),
      lotId: optStr(b.lotId),
      batch: optStr(b.batch, 40),
      expiry: optStr(b.expiry, 10),
      unitCost: b.unitCost === undefined || b.unitCost === null || b.unitCost === "" ? null : int(b.unitCost),
    })
  );
}
