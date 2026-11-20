import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { isStateCode, normaliseGstin, validGstin } from "@/lib/gst";

const SELECT = { id: true, outletName: true, gstin: true, legalName: true, stateCode: true } as const;

/** A retailer's GST details (used on their invoices from now on; issued invoices keep their snapshot). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("retailers.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const r = await auth.db.retailerProfile.findUnique({ where: { id }, select: SELECT });
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ retailer: r });
}

/** Body: { gstin?, legalName?, stateCode? } — null / "" clears. A GSTIN sets the state from its first two digits. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("retailers.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const { id } = await params;
  const before = await db.retailerProfile.findUnique({ where: { id }, select: SELECT });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const data: { gstin?: string | null; legalName?: string | null; stateCode?: string | null } = {};
  if ("gstin" in b) {
    const g = normaliseGstin(b.gstin);
    if (g && !validGstin(g)) return NextResponse.json({ error: "That GSTIN is not valid (check the 15 characters)" }, { status: 400 });
    if (g) {
      const taken = await db.retailerProfile.findFirst({ where: { gstin: g, id: { not: id } }, select: { outletName: true } });
      if (taken) return NextResponse.json({ error: `${taken.outletName} already has this GSTIN` }, { status: 409 });
    }
    data.gstin = g || null;
    if (g) data.stateCode = g.slice(0, 2);
  }
  if ("legalName" in b) data.legalName = String(b.legalName ?? "").trim().slice(0, 100) || null;
  if ("stateCode" in b && !data.gstin) {
    if (b.stateCode !== null && b.stateCode !== "" && !isStateCode(b.stateCode)) return NextResponse.json({ error: "Choose a state" }, { status: 400 });
    const gstin = data.gstin === undefined ? before.gstin : data.gstin;
    if (gstin && b.stateCode && gstin.slice(0, 2) !== b.stateCode) return NextResponse.json({ error: "The state must match the GSTIN" }, { status: 400 });
    data.stateCode = (b.stateCode as string) || null;
  }
  const after = await db.retailerProfile.update({ where: { id }, data, select: SELECT });
  await audit(db, { actorId: session.userId, action: "retailer.gst", entity: "RetailerProfile", entityId: id, before, after, ip: requestIp(req) });
  return NextResponse.json({ retailer: after });
}
