import { binExpired } from "@/lib/stock";
import { stockMutation } from "@/lib/stock-api";

/** Move every expired batch in the warehouses to the damaged bin. */
export async function POST(req: Request) {
  return stockMutation(req, "stock.bin_expired", async (ctx) => ({ batches: await binExpired(ctx) }));
}
