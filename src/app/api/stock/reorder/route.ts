import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { reorderList } from "@/lib/stock";

/** Products at or below their reorder level, with what is on order and a suggested quantity. */
export async function GET() {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const rows = await withTenantTx(auth.tenant.id, (tx) => reorderList(tx));
  return NextResponse.json({ rows });
}
