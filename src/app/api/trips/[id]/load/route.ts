import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { MoneyError, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { loadPlan, loadVan } from "@/lib/stock";
import { stockMutation } from "@/lib/stock-api";

/**
 * Van load sheet for a trip: per product what the trip's orders need, what
 * other open trips on the van need, what is already in the van, the buffer
 * for spot sales, the suggested load, warehouse stock and first-expiry-first
 * batches. enabled=false when stock tracking is off; rows empty without a van.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard(["orders.dispatch", "stock.view"]);
  if (!auth.ok) return auth.res;
  const { id } = await params;
  try {
    const plan = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => loadPlan(ctx, id));
    return NextResponse.json(plan);
  } catch (e) {
    return moneyFail(e);
  }
}

/**
 * Load the van. Body: { rows: [{ productId, qty }], override? }. Refused (409,
 * with stockShort) when the warehouse records show less; override books the
 * missing units in first ("records were short at loading").
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return stockMutation(
    req,
    "trip.load",
    async (ctx, b) => {
      const rows = (Array.isArray(b.rows) ? b.rows : []).map((r: Record<string, unknown>) => ({ productId: String(r?.productId ?? ""), qty: Number(r?.qty) }));
      for (const r of rows) if (!Number.isInteger(r.qty) || r.qty < 0) throw new MoneyError("Quantities must be whole numbers");
      return { products: await loadVan(ctx, id, rows, { override: b.override === true }) };
    },
    { entity: "Trip", entityId: id }
  );
}
