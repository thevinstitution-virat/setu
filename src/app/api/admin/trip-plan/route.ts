import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { moneyFail } from "@/lib/money-api";
import { isDay } from "@/lib/field-math";
import { planTrips } from "@/lib/automation";
import { automationSettings } from "@/lib/automation-settings";

/** POST { date, slot? } → split the orders waiting for that day and slot into trips; returns the suggestion to accept. */
export async function POST(req: Request) {
  const auth = await guard("orders.dispatch");
  if (!auth.ok) return auth.res;
  const b = (await req.json().catch(() => null)) as { date?: unknown; slot?: unknown } | null;
  if (!b || !isDay(b.date)) return NextResponse.json({ error: "Pick a day" }, { status: 400 });
  if (b.slot !== undefined && typeof b.slot !== "string") return NextResponse.json({ error: "Pick a slot" }, { status: 400 });
  const date = b.date;
  const slot = b.slot as string | undefined;
  try {
    const s = await withTenantTx(
      auth.tenant.id,
      async (tx) => {
        const t = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } });
        return planTrips({ tx, tenantId: auth.tenant.id, actorId: auth.session.userId }, { date, slot }, new Date(), automationSettings(t.settings));
      },
      { timeout: 60_000 }
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "trip.plan", entity: "Suggestion", entityId: s?.id, ip: requestIp(req) });
    return NextResponse.json({ suggestion: s });
  } catch (e) {
    return moneyFail(e);
  }
}
