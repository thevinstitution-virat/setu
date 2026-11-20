import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { stockAlerts } from "@/lib/stock";

/** Dashboard counts: products to reorder, batches expiring soon, expired batches. null when stock tracking is off. */
export async function GET() {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const alerts = await withTenantTx(auth.tenant.id, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } });
    return stockAlerts(tx, t.settings);
  });
  return NextResponse.json({ alerts });
}
