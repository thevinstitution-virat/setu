import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { platformGuard } from "@/lib/platform-auth";
import type { Prisma } from "@/generated/prisma/client";

/** What platform users did. ?tenantId= &action= &before=<ISO> (paging) */
export async function GET(req: Request) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const where: Prisma.PlatformAuditWhereInput = {};
  if (sp.get("tenantId")) where.targetTenantId = sp.get("tenantId")!;
  if (sp.get("action")) where.action = { startsWith: sp.get("action")! };
  const before = sp.get("before") ? new Date(sp.get("before")!) : null;
  if (before && !Number.isNaN(before.getTime())) where.createdAt = { lt: before };
  const rows = await prisma.platformAudit.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { actor: { select: { name: true } } } });
  const tenants = await prisma.tenant.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.targetTenantId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const tn = new Map(tenants.map((t) => [t.id, t.name]));
  return NextResponse.json({ entries: rows.map(({ targetTenantId, ...r }) => ({ ...r, tenantId: targetTenantId, by: r.actor?.name ?? null, tenantName: targetTenantId ? (tn.get(targetTenantId) ?? null) : null })) });
}
