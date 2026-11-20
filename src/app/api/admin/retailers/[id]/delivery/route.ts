import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { parseRetailerDelivery } from "@/lib/delivery-settings";

const SELECT = { id: true, outletName: true, deliveryPref: true, deliveryNote: true, lat: true, lng: true } as const;

/** A shop's delivery preference, note and map pin. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("ledger.view");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const r = await auth.db.retailerProfile.findUnique({ where: { id }, select: SELECT });
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(r);
}

/** Body: { deliveryPref?, deliveryNote?, lat?, lng? } — lat and lng together; both null clears the pin. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("retailers.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const before = await auth.db.retailerProfile.findUnique({ where: { id }, select: SELECT });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = parseRetailerDelivery((await req.json().catch(() => null)) ?? {}, { location: true });
  if (typeof data === "string") return NextResponse.json({ error: data }, { status: 400 });
  const after = await auth.db.retailerProfile.update({ where: { id }, data, select: SELECT });
  await audit(auth.db, { actorId: auth.session.userId, action: "retailer.delivery", entity: "RetailerProfile", entityId: id, before, after, ip: requestIp(req) });
  return NextResponse.json(after);
}
