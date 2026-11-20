import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { withMoney } from "@/lib/ledger";
import { returnableBalances } from "@/lib/delivery";

/**
 * Crates / jars held per retailer. ?retailerId= for one shop.
 * Retailers see only their own; drivers see the shops on their open stops;
 * staff with ledger.view see everyone.
 */
export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  let retailerId = new URL(req.url).searchParams.get("retailerId") || undefined;

  if (session.role === "RETAILER") {
    const me = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (!me) return NextResponse.json({ balances: [] });
    retailerId = me.id;
  } else if (!can(session.role, "ledger.view")) {
    if (!retailerId) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
    const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    const stop = agent
      ? await db.delivery.findFirst({ where: { deliveryAgentId: agent.id, state: "ASSIGNED", order: { retailerId } }, select: { id: true } })
      : null;
    if (!stop) return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  }

  const [rows, types] = await Promise.all([
    withMoney(tenant.id, null, (ctx) => returnableBalances(ctx, retailerId)),
    db.returnable.findMany({ select: { id: true, name: true, unitCharge: true, active: true } }),
  ]);
  const names = new Map(types.map((t) => [t.id, t]));
  const retailers = retailerId
    ? []
    : await db.retailerProfile.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.retailerId))] } }, select: { id: true, outletName: true } });
  const outlet = new Map(retailers.map((r) => [r.id, r.outletName]));
  return NextResponse.json({
    balances: rows.map((r) => ({
      ...r,
      name: names.get(r.returnableId)?.name ?? "",
      unitCharge: names.get(r.returnableId)?.unitCharge ?? 0,
      outletName: outlet.get(r.retailerId) ?? null,
    })),
  });
}
