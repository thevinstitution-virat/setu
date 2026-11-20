import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { parsePeriod } from "@/lib/analytics";
import { loadShop } from "@/lib/reports";

/** GET ?preset= | ?from=&to= → one shop's rhythm, month trend, product mix, money owed and returns. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("reports.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  try {
    const { period, preset } = parsePeriod(new URL(req.url).searchParams);
    const data = await loadShop(auth.tenant.id, id, period);
    return NextResponse.json({ period: { from: period.from, to: period.to, days: period.days, preset }, data }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
