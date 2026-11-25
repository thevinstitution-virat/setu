import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { claimBasis } from "@/lib/claims";
import { isClaimType } from "@/lib/claim-labels";

/** GET ?supplier=&type=SCHEME|DAMAGE|RATE_DIFF&from=&to=: lines the app's own records suggest for a claim. */
export async function GET(req: Request) {
  const auth = await guard("claims.manage");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type");
  if (!isClaimType(type)) return NextResponse.json({ error: "Pick what the claim is for" }, { status: 400 });
  try {
    const basis = await withMoney(auth.tenant.id, auth.session.userId, (ctx) =>
      claimBasis(ctx, { supplierId: String(sp.get("supplier") ?? ""), type, from: String(sp.get("from") ?? ""), to: sp.get("to") }),
    );
    return NextResponse.json(basis, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
