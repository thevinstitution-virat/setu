import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { stopShareLinks } from "@/lib/invoice-api";

/** "Stop old links": every share link sent for this document so far stops working. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("invoices.manage");
  if (!auth.ok) return auth.res;
  const { db, session } = auth;
  const { id } = await params;
  if (!(await db.invoice.findUnique({ where: { id }, select: { id: true } }))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await stopShareLinks(db, id);
  await audit(db, { actorId: session.userId, action: "invoice.share_stopped", entity: "Invoice", entityId: id, after: r, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
