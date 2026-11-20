import { NextResponse } from "next/server";
import { withTenantTx } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { queueExport } from "@/lib/tenant-data";
import { prisma } from "@/lib/prisma";

/**
 * Make a copy of a business's data on its behalf (OWNER; e.g. the owner lost
 * access). The copy is downloaded by the business under Settings → Data; the
 * platform never downloads it.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/platform/tenants/[id]/export">) {
  const g = await platformGuard("OWNER");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const t = await prisma.tenant.findUnique({ where: { id }, select: { status: true } });
  if (!t || t.status === "CLOSED") return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const e = await withTenantTx(id, (tx) => tx.tenantExport.create({ data: { tenantId: id, requestedBy: `platform:${g.session.platformUserId}` } }));
  await queueExport(id, e.id);
  await platformAudit(g.session.platformUserId, "tenant.export", { tenantId: id, detail: { exportId: e.id }, ip: requestIp(req) });
  return NextResponse.json({ id: e.id, status: e.status }, { status: 202 });
}
