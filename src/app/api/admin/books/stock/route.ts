import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { withMoney, type Ctx } from "@/lib/ledger";
import { todayIst } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { closingStock, stockChoices, stockValuation } from "@/lib/stock-counts";
import { valuationCsv, valuationSheet } from "@/lib/stock-counts-export";
import { isValuationBy } from "@/lib/stock-count-labels";

/**
 * GET ?day=&by=company|category|place|product&locationId=&supplierId=&categoryId=[&format=pdf|csv]: stock at cost as at the end of a day.
 * GET ?closing=1&day=: the closing stock for the final accounts, with where it came from.
 * GET ?options=1: places, companies and categories.
 */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const day = sp.get("day") || todayIst();
  const run = <T>(fn: (ctx: Ctx) => Promise<T>) => withMoney(auth.tenant.id, auth.session.userId, fn);
  try {
    if (sp.get("options") === "1") return NextResponse.json(await run((ctx) => stockChoices(ctx)), { headers: { "cache-control": "no-store" } });
    if (sp.get("closing") === "1") return NextResponse.json(await run((ctx) => closingStock(ctx, day)), { headers: { "cache-control": "no-store" } });
    const by = sp.get("by");
    const v = await run((ctx) =>
      stockValuation(ctx, {
        day,
        by: isValuationBy(by) ? by : "company",
        locationId: sp.get("locationId") || null,
        supplierId: sp.get("supplierId") || null,
        categoryId: sp.get("categoryId") || null,
      }),
    );
    const format = sp.get("format");
    if (format === "pdf" || format === "csv") return fileResponse(auth.db, auth.tenant.id, format, `stock-value-${day}`, valuationCsv(v), valuationSheet(v));
    return NextResponse.json(v, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
