import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { queueExport } from "@/lib/tenant-data";

const view = (e: { id: string; status: string; bytes: number | null; rows: number | null; createdAt: Date; readyAt: Date | null; expiresAt: Date | null; forDeletion: boolean; error: string | null }) => ({
  id: e.id,
  status: e.status,
  bytes: e.bytes,
  rows: e.rows,
  createdAt: e.createdAt,
  readyAt: e.readyAt,
  expiresAt: e.expiresAt,
  forDeletion: e.forDeletion,
  error: e.status === "FAILED" ? "The export failed. Try again, or contact support." : null,
  downloadUrl: e.status === "READY" ? `/api/admin/export/${e.id}` : null,
});

/** Copies of all the business's data (DPDP). */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const rows = await auth.db.tenantExport.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  return NextResponse.json({ exports: rows.map(view) });
}

/** Make a new copy (one an hour). It is ready in a few minutes; download it within 7 days. */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { db, tenant, session } = auth;
  const recent = await db.tenantExport.count({ where: { createdAt: { gte: new Date(Date.now() - 3600_000) }, status: { in: ["QUEUED", "RUNNING", "READY"] } } });
  if (recent) return NextResponse.json({ error: "A copy was made in the last hour. Download that one, or try again later." }, { status: 429 });
  const e = await db.tenantExport.create({ data: { requestedBy: session.userId } });
  await queueExport(tenant.id, e.id);
  await audit(db, { actorId: session.userId, action: "tenant.export", entity: "TenantExport", entityId: e.id, ip: requestIp(req) });
  return NextResponse.json(view(e), { status: 202 });
}
