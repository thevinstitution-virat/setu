import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { isDay } from "@/lib/books";
import { claimsList, openClaimsFor, raiseClaim, type ClaimFilter, type ClaimInput } from "@/lib/claims";
import { isClaimType } from "@/lib/claim-labels";

/** GET ?status=open|closed|<status>&supplier=&type=&from=&to=: claims on companies. ?open=1&supplier=: that company's open claims (for a credit note). */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const supplierId = sp.get("supplier") || null;
  if (sp.get("open") === "1") {
    if (!supplierId) return NextResponse.json({ error: "Pick the company" }, { status: 400 });
    const claims = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => openClaimsFor(ctx, supplierId));
    return NextResponse.json({ claims }, { headers: { "cache-control": "no-store" } });
  }
  const t = sp.get("type");
  const from = sp.get("from");
  const to = sp.get("to");
  if ((from && !isDay(from)) || (to && !isDay(to))) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  const f: ClaimFilter = { status: (sp.get("status") as ClaimFilter["status"]) || null, supplierId, type: isClaimType(t) ? t : null, from, to };
  const claims = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => claimsList(ctx, f));
  return NextResponse.json({ claims }, { headers: { "cache-control": "no-store" } });
}

/** POST ClaimInput (paise): raise a claim on a company. */
export async function POST(req: Request) {
  const auth = await guard("claims.manage");
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => null)) as ClaimInput | null;
  if (!body) return NextResponse.json({ error: "Nothing sent" }, { status: 400 });
  try {
    const c = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => raiseClaim(ctx, body));
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "claim.raise",
      entity: "Claim",
      entityId: c.id,
      after: { number: c.number, supplierId: c.supplierId, type: c.type, amount: c.amount },
      ip: requestIp(req),
    });
    return NextResponse.json({ claim: c }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
