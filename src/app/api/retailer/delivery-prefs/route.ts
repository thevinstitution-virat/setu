import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { parseRetailerDelivery } from "@/lib/delivery-settings";

const SELECT = { id: true, deliveryPref: true, deliveryNote: true } as const;

/** The signed-in retailer's delivery preference and note for the driver. */
export async function GET() {
  const auth = await guard("orders.place");
  if (!auth.ok) return auth.res;
  const me = await auth.db.retailerProfile.findUnique({ where: { userId: auth.session.userId }, select: SELECT });
  if (!me) return NextResponse.json({ error: "Not a retailer" }, { status: 403 });
  return NextResponse.json(me);
}

/** Body: { deliveryPref?: RING_BELL|AT_DOOR|IN_HAND|KEEP_IN_BAG|null, deliveryNote? } */
export async function PATCH(req: Request) {
  const auth = await guard("orders.place");
  if (!auth.ok) return auth.res;
  const me = await auth.db.retailerProfile.findUnique({ where: { userId: auth.session.userId }, select: SELECT });
  if (!me) return NextResponse.json({ error: "Not a retailer" }, { status: 403 });
  const data = parseRetailerDelivery((await req.json().catch(() => null)) ?? {}, { location: false });
  if (typeof data === "string") return NextResponse.json({ error: data }, { status: 400 });
  const after = await auth.db.retailerProfile.update({ where: { id: me.id }, data, select: SELECT });
  await audit(auth.db, { actorId: auth.session.userId, action: "retailer.delivery_prefs", entity: "RetailerProfile", entityId: me.id, before: me, after, ip: requestIp(req) });
  return NextResponse.json(after);
}
