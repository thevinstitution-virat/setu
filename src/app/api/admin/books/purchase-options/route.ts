import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withMoney } from "@/lib/ledger";
import { ensureBooks } from "@/lib/books";
import { purchaseOptions } from "@/lib/purchases";

/** What the purchase form needs: suppliers, products, heads, stock tracking and unbilled goods received. */
export async function GET() {
  const auth = await guard("purchases.manage");
  if (!auth.ok) return auth.res;
  const options = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
    await ensureBooks(ctx);
    return purchaseOptions(ctx);
  });
  return NextResponse.json(options, { headers: { "cache-control": "no-store" } });
}
