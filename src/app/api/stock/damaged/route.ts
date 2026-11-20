import { clearDamaged } from "@/lib/stock";
import { int, optStr, str, stockMutation } from "@/lib/stock-api";

/**
 * Clear goods out of the damaged bin. Body: { productId, qty, lotId?,
 * to: "WRITE_OFF" | "SUPPLIER_RETURN", supplierId? (supplier return), note? }
 */
export async function POST(req: Request) {
  return stockMutation(req, "stock.damaged_clear", async (ctx, b) => {
    const to = b.to === "SUPPLIER_RETURN" ? "SUPPLIER_RETURN" : "WRITE_OFF";
    const picks = await clearDamaged(ctx, { productId: str(b.productId), qty: int(b.qty), lotId: optStr(b.lotId), to, supplierId: optStr(b.supplierId), note: optStr(b.note, 300) });
    return { cleared: picks.reduce((a, p) => a + p.qty, 0) };
  });
}
