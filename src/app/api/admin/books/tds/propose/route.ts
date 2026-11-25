import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { todayIst } from "@/lib/books";
import { proposeTds } from "@/lib/tds";

/** GET ?section&base (paise)&date&basis=BILL|PAYMENT&supplierId | pan&party &excludeId: the TDS the app works out, and why. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  try {
    const r = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      proposeTds(ctx, {
        section: sp.get("section") ?? "",
        base: Number(sp.get("base") ?? 0),
        date: sp.get("date") || todayIst(),
        basis: sp.get("basis") === "BILL" ? "BILL" : "PAYMENT",
        supplierId: sp.get("supplierId") || null,
        pan: sp.get("pan") || null,
        party: sp.get("party") || null,
        excludeId: sp.get("excludeId") || null,
      }),
    );
    return NextResponse.json(r, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
