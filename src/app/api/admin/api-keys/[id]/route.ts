import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";

/** Revoke a key (it stops working at once; the row stays for the record). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("integrations.manage");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const r = await db.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!r.count) return NextResponse.json({ error: "Key not found or already revoked" }, { status: 404 });
  await audit(db, { actorId: session.userId, action: "api_key.revoke", entity: "ApiKey", entityId: id, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
