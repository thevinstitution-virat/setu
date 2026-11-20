import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { inventorySettings } from "@/lib/inventory-settings";
import { reorderList, stockLevels } from "@/lib/stock";
import { addDays, istToday } from "@/lib/stock-math";

/**
 * Stock overview: every active product with warehouse / van / damaged /
 * expired / on open orders / available, its reorder level and supplier, and
 * flags (low, out, expiring soon, expired). ?q= search, ?filter=low|out|expiring|expired.
 * Also the places (warehouses, vans, damaged bin) and the stock value.
 */
export async function GET(req: Request) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const filter = sp.get("filter");

  const data = await withTenantTx(auth.tenant.id, async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } });
    const settings = inventorySettings(t.settings);
    const today = istToday();
    const soon = addDays(today, settings.expiryAlertDays);
    const [products, levels, reorder, expiringLots, locations] = await Promise.all([
      tx.product.findMany({
        where: { active: true },
        orderBy: [{ sort: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          sku: true,
          unit: true,
          caseUnit: true,
          caseSize: true,
          reorderLevel: true,
          reorderQty: true,
          trackExpiry: true,
          lastCost: true,
          supplier: { select: { id: true, name: true } },
          category: { select: { name: true } },
        },
      }),
      stockLevels(tx),
      reorderList(tx),
      tx.stockLot.findMany({
        where: { qty: { gt: 0 }, expiry: { lte: soon }, location: { kind: { in: ["WAREHOUSE", "VAN"] } } },
        select: { productId: true, expiry: true, qty: true },
      }),
      tx.stockLocation.findMany({ where: { active: true }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, kind: true, name: true, isDefault: true, vehicleId: true } }),
    ]);
    const toReorder = new Set(reorder.map((r) => r.productId));
    const nextExpiry = new Map<string, { date: Date; qty: number; expired: boolean }>();
    for (const l of expiringLots) {
      const cur = nextExpiry.get(l.productId);
      if (!cur || l.expiry! < cur.date) nextExpiry.set(l.productId, { date: l.expiry!, qty: l.qty, expired: l.expiry! < today });
    }
    let rows = products.map((p) => {
      const lv = levels.get(p.id) ?? { warehouse: 0, van: 0, damaged: 0, expired: 0, reserved: 0, available: 0, value: 0 };
      const ex = nextExpiry.get(p.id) ?? null;
      return {
        ...p,
        warehouse: lv.warehouse,
        van: lv.van,
        damaged: lv.damaged,
        expired: lv.expired,
        reserved: lv.reserved,
        available: lv.available,
        value: lv.value,
        low: toReorder.has(p.id),
        out: lv.available <= 0,
        nextExpiry: ex ? { date: ex.date.toISOString().slice(0, 10), qty: ex.qty, expired: ex.expired } : null,
      };
    });
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q));
    if (filter === "low") rows = rows.filter((r) => r.low);
    else if (filter === "out") rows = rows.filter((r) => r.out);
    else if (filter === "expiring") rows = rows.filter((r) => r.nextExpiry && !r.nextExpiry.expired);
    else if (filter === "expired") rows = rows.filter((r) => r.expired > 0);
    const all = [...levels.values()];
    return {
      settings,
      products: rows,
      locations,
      totals: {
        value: all.reduce((a, l) => a + l.value, 0),
        low: reorder.length,
        out: products.filter((p) => (levels.get(p.id)?.available ?? 0) <= 0).length,
        expiringSoon: [...nextExpiry.values()].filter((e) => !e.expired).length,
        expired: all.filter((l) => l.expired > 0).length,
      },
    };
  });
  return NextResponse.json(data);
}
