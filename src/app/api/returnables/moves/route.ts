import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { keyBelongsTo } from "@/lib/storage";
import { kickPhotos } from "@/lib/jobs";
import { MoneyError, withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { chargeReturnables, recordReturnables } from "@/lib/delivery";

/**
 * Crate / jar movements outside a delivery.
 * Body: { retailerId, kind: "PICKUP" | "OPENING" | "ADJUST" | "CHARGE", note?, photoKey?,
 *         rows: [{ returnableId, given, taken }]          (PICKUP / OPENING / ADJUST)
 *         returnableId, units                             (CHARGE: bill units not returned) }
 * PICKUP: the driver collects empties at a shop on their open stops (or staff).
 * OPENING / ADJUST / CHARGE: ledger.adjust.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const body = await req.json().catch(() => null);
  const retailerId = String(body?.retailerId ?? "");
  const kind = String(body?.kind ?? "");
  if (!["PICKUP", "OPENING", "ADJUST", "CHARGE"].includes(kind)) return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
  const retailer = await db.retailerProfile.findUnique({ where: { id: retailerId }, select: { id: true } });
  if (!retailer) return NextResponse.json({ error: "Retailer not found" }, { status: 404 });

  let tripId: string | null = null;
  if (kind === "PICKUP" && !can(session.role, "ledger.adjust")) {
    const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    const stop = agent
      ? await db.delivery.findFirst({ where: { deliveryAgentId: agent.id, order: { retailerId }, trip: { status: "STARTED" } }, select: { tripId: true } })
      : null;
    if (!stop) return NextResponse.json({ error: "This shop isn't on your trip" }, { status: 403 });
    tripId = stop.tripId;
  } else if (kind !== "PICKUP" && !can(session.role, "ledger.adjust")) {
    return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
  }

  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) || null : null;
  const photoKey = typeof body?.photoKey === "string" && keyBelongsTo(body.photoKey, tenant.id) ? body.photoKey : null;
  let bill = null;
  try {
    await withMoney(tenant.id, session.userId, async (ctx) => {
      if (kind === "CHARGE") {
        bill = await chargeReturnables(ctx, retailerId, String(body?.returnableId ?? ""), Number(body?.units), note);
        return;
      }
      if (kind === "ADJUST" && !note) throw new MoneyError("Write why the count changed");
      const rows = Array.isArray(body?.rows) ? body.rows : [];
      if (kind === "PICKUP" && rows.some((r: { given?: number }) => Number(r?.given ?? 0) > 0)) {
        throw new MoneyError("A pickup only takes empties back");
      }
      await recordReturnables(
        ctx,
        retailerId,
        rows.map((r: Record<string, unknown>) => ({ returnableId: String(r?.returnableId ?? ""), given: Number(r?.given ?? 0), taken: Number(r?.taken ?? 0) })),
        { kind: kind as "PICKUP" | "OPENING" | "ADJUST", tripId, note, photoKey }
      );
    });
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, { actorId: session.userId, action: `returnable.${kind.toLowerCase()}`, entity: "RetailerProfile", entityId: retailerId, after: { rows: body?.rows ?? null, returnableId: body?.returnableId ?? null, units: body?.units ?? null, note }, ip: requestIp(req) });
  if (photoKey && kind === "PICKUP") await kickPhotos(tenant.id);
  return NextResponse.json({ ok: true, bill });
}
