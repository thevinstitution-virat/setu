import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { generateEway } from "@/lib/einvoice";
import { moneyFail } from "@/lib/money-api";

/** Body: { vehicleNo, distanceKm } — e-way bill for a sale invoice, by road. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("invoices.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const inv = await db.invoice.findUnique({ where: { id }, select: { id: true } });
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let doc;
  try {
    doc = await generateEway(tenant.id, id, { vehicleNo: String(b.vehicleNo ?? ""), distanceKm: Number(b.distanceKm) });
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, {
    actorId: session.userId,
    action: "invoice.eway",
    entity: "Invoice",
    entityId: id,
    after: { ewbNo: doc?.ewbNo, vehicle: doc?.ewbVehicle, distanceKm: doc?.ewbDistanceKm },
    ip: requestIp(req),
  });
  return NextResponse.json({ invoice: doc });
}
