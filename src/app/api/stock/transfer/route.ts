import { transferStock } from "@/lib/stock";
import { int, optStr, str, stockMutation } from "@/lib/stock-api";

/** Move stock between two warehouses. Body: { fromId, toId, productId, qty, lotId?, note? } */
export async function POST(req: Request) {
  return stockMutation(req, "stock.transfer", async (ctx, b) => {
    const picks = await transferStock(ctx, { fromId: str(b.fromId), toId: str(b.toId), productId: str(b.productId), qty: int(b.qty), lotId: optStr(b.lotId), note: optStr(b.note, 300) });
    return { moved: picks.reduce((a, p) => a + p.qty, 0) };
  });
}
