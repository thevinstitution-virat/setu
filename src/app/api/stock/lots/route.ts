import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { addDays, isExpired, istToday } from "@/lib/stock-math";
import { inventorySettings } from "@/lib/inventory-settings";

/**
 * Batches in stock. ?productId= one product, ?locationId= one place,
 * ?expiring=1 only batches expiring within the warning days (or expired).
 * First expiry first.
 */
export async function GET(req: Request) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const productId = sp.get("productId");
  const locationId = sp.get("locationId");
  const today = istToday();
  let expiryFilter = {};
  if (sp.get("expiring") === "1") {
    const t = await auth.db.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } });
    expiryFilter = { expiry: { lte: addDays(today, inventorySettings(t.settings).expiryAlertDays) } };
  }
  const lots = await auth.db.stockLot.findMany({
    where: { qty: { gt: 0 }, ...(productId ? { productId } : {}), ...(locationId ? { locationId } : {}), ...expiryFilter },
    orderBy: [{ expiry: { sort: "asc", nulls: "last" } }, { receivedAt: "asc" }],
    take: 500,
    include: {
      product: { select: { id: true, name: true, sku: true, unit: true } },
      location: { select: { id: true, name: true, kind: true } },
    },
  });
  return NextResponse.json({
    lots: lots.map((l) => ({
      id: l.id,
      product: l.product,
      location: l.location,
      batch: l.batch,
      expiry: l.expiry ? l.expiry.toISOString().slice(0, 10) : null,
      mfgDate: l.mfgDate ? l.mfgDate.toISOString().slice(0, 10) : null,
      qty: l.qty,
      unitCost: l.unitCost,
      receivedAt: l.receivedAt,
      expired: isExpired(l, today),
    })),
  });
}
