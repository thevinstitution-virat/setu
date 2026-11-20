import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { MoneyError, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { unloadPlan, unloadVan } from "@/lib/stock";
import { optStr, stockMutation } from "@/lib/stock-api";

/**
 * Suggested unload counts for a trip's van: everything on hand back to the
 * warehouse, except lines delivered short as damaged / expired (counted as damaged).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(["orders.dispatch", "stock.view"]);
  if (!auth.ok) return auth.res;
  const { id } = await params;
  try {
    return NextResponse.json(await withMoney(auth.tenant.id, auth.session.userId, (ctx) => unloadPlan(ctx, id)));
  } catch (e) {
    return moneyFail(e);
  }
}

/**
 * Unload the van after the trip. Body: { rows: [{ productId, good, damaged, keep }], note? }.
 * good → warehouse, damaged → damaged bin, keep stays in the van; anything
 * not counted is booked as missing from the van (or extra, when more came back).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stockMutation(
    req,
    "trip.unload",
    async (ctx, b) => {
      const trip = await ctx.tx.trip.findUnique({ where: { id }, select: { vehicleId: true } });
      if (!trip) throw new MoneyError("Trip not found", 404);
      if (!trip.vehicleId) throw new MoneyError("This trip has no van");
      const rows = (Array.isArray(b.rows) ? b.rows : []).map((r: Record<string, unknown>) => ({
        productId: String(r?.productId ?? ""),
        good: Number(r?.good ?? 0),
        damaged: Number(r?.damaged ?? 0),
        keep: Number(r?.keep ?? 0),
      }));
      if (!rows.length) throw new MoneyError("Nothing to unload");
      return unloadVan(ctx, trip.vehicleId, rows, { tripId: id, note: optStr(b.note, 300) });
    },
    { entity: "Trip", entityId: id }
  );
}
