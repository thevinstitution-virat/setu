import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { addDay, istDay } from "@/lib/field-math";
import { toCsv } from "@/lib/field";
import { automationSettings } from "@/lib/automation-settings";
import { loadSheet } from "@/lib/forecast";

/** A6 next-day load sheet: GET ?date=YYYY-MM-DD (default tomorrow, IST); &format=csv downloads it. */
export async function GET(req: Request) {
  const auth = await guard("stock.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const now = new Date();
  const date = sp.get("date") ?? addDay(istDay(now), 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return NextResponse.json({ error: "Pick a day" }, { status: 400 });
  const sheet = await withTenantTx(
    auth.tenant.id,
    async (tx) => {
      const s = automationSettings((await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } })).settings);
      return loadSheet({ tx, tenantId: auth.tenant.id, actorId: auth.session.userId }, date, now, s);
    },
    { timeout: 45_000 }
  );
  if (sp.get("format") === "csv") {
    const rows: (string | number | null)[][] = [
      ["Category", "Product", "SKU", "Unit", "Booked", "Usual", "Extra", "Load", "In warehouse", "Short"],
      ...sheet.rows.map((r) => [r.category, r.name, r.sku, r.unit, r.booked, r.usual, r.extra, r.suggested, r.warehouse, r.short]),
    ];
    return new NextResponse(toCsv(rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="load-sheet-${date}.csv"` } });
  }
  return NextResponse.json(sheet);
}
