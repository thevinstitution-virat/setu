import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { toCsv } from "@/lib/field";
import { automationSettings } from "@/lib/automation-settings";
import { forecastTable } from "@/lib/forecast";

/** A6 demand forecast: each product's daily demand, days of stock left and what to reorder. &format=csv downloads it. */
export async function GET(req: Request) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const now = new Date();
  const t = await withTenantTx(
    auth.tenant.id,
    async (tx) => {
      const s = automationSettings((await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } })).settings);
      return forecastTable(tx, auth.tenant.id, now, s);
    },
    { timeout: 45_000 }
  );
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const rows: (string | number | null)[][] = [
      ["Product", "SKU", "Unit", "Per day", "Spread", "Days with orders", "Available", "On order", "Days left", "Runs out", "Supplier", "Lead days", "Order now"],
      ...t.rows.map((r) => [r.name, r.sku, r.unit, r.daily, r.sigma, r.activeDays, r.available, r.onOrder, r.daysLeft, r.runsOut, r.supplierName, r.leadDays, r.reorderQty]),
    ];
    return new NextResponse(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="forecast-${t.today}.csv"` } });
  }
  return NextResponse.json(t);
}
