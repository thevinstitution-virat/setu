import { draftReorderPos } from "@/lib/stock";
import { stockMutation } from "@/lib/stock-api";

/**
 * Draft purchase orders from the reorder list, one per supplier, with the
 * suggested quantities. Body: { productIds? } (default: everything to reorder).
 * Products without a supplier are skipped and listed.
 */
export async function POST(req: Request) {
  return stockMutation(
    req,
    "po.draft_reorder",
    async (ctx, b) => {
      const ids = Array.isArray(b.productIds) ? b.productIds.map(String).slice(0, 500) : undefined;
      const { pos, skipped } = await draftReorderPos(ctx, ids);
      return { orders: pos.map((p) => ({ id: p.id, number: p.number, lines: p.lines.length })), skipped };
    },
    { entity: "PurchaseOrder", status: 201 }
  );
}
