import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asPlatform } from "@/lib/db";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { requestIp } from "@/lib/audit";
import { ConsoleAdminError, createBusiness } from "@/lib/console-admins";
import type { Prisma, TenantStatus } from "@/generated/prisma/client";

const STATUSES: TenantStatus[] = ["TRIAL", "ACTIVE", "SUSPENDED", "CLOSED"];

/**
 * All businesses with their plan and a few health numbers.
 * ?q= (name, address, GSTIN) &status= &take=
 */
export async function GET(req: Request) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const where: Prisma.TenantWhereInput = {};
  const q = sp.get("q")?.trim();
  if (q) where.OR = [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q.toLowerCase() } }, { gstin: { contains: q.toUpperCase() } }];
  const status = sp.get("status") as TenantStatus | null;
  if (status && STATUSES.includes(status)) where.status = status;
  else where.status = { not: "CLOSED" };
  const take = Math.min(Number(sp.get("take")) || 100, 500);

  // asPlatform: the subscription is a per-business row (row-level security).
  const tenants = await asPlatform((tx) =>
    tx.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, slug: true, name: true, status: true, plan: true, createdAt: true, suspendReason: true, deleteAfter: true, subscription: { select: { status: true, planCode: true, nextPlanCode: true, trialEndsAt: true, periodEnd: true } } },
    })
  );
  const ids = tenants.map((t) => t.id);
  const since = new Date(Date.now() - 30 * 86_400_000);
  // Platform-wide counts in a few grouped queries (RLS bypass for the platform).
  const [staff, shops, orders, lastOrder, overdue] = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
    return Promise.all([
      tx.user.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, active: true, isSupport: false, role: { not: "RETAILER" } }, _count: true }),
      tx.user.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, active: true, role: "RETAILER" }, _count: true }),
      tx.order.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, createdAt: { gte: since } }, _count: true }),
      tx.order.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids } }, _max: { createdAt: true } }),
      tx.platformInvoice.groupBy({ by: ["tenantId"], where: { tenantId: { in: ids }, status: "ISSUED", dueAt: { lte: new Date() } }, _sum: { total: true } }),
    ]);
  });
  const m = <T extends { tenantId: string }>(rows: T[]) => new Map(rows.map((r) => [r.tenantId, r]));
  const [ms, mr, mo, ml, md] = [m(staff), m(shops), m(orders), m(lastOrder), m(overdue)];
  return NextResponse.json({
    tenants: tenants.map((t) => ({
      ...t,
      staff: ms.get(t.id)?._count ?? 0,
      retailers: mr.get(t.id)?._count ?? 0,
      orders30d: mo.get(t.id)?._count ?? 0,
      lastOrderAt: ml.get(t.id)?._max.createdAt ?? null,
      overduePaise: md.get(t.id)?._sum.total ?? 0,
    })),
  });
}

/**
 * Super-admin only: a new business with its owner admin (no password yet).
 * Body { slug, name, planCode?, admin: { name, loginId, phone?, email? } } → { tenant, url, emailed }:
 * url is the owner's set-password link (3 days, once); it is emailed too when an address is given.
 */
export async function POST(req: Request) {
  const g = await platformGuard("OWNER");
  if (!g.ok) return g.res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Send the business as JSON" }, { status: 400 });
  try {
    const r = await createBusiness({ slug: body.slug, name: body.name, planCode: body.planCode, admin: (body.admin ?? {}) as Record<string, unknown> });
    await platformAudit(g.session.platformUserId, "tenant.create", { tenantId: r.tenant.id, detail: { slug: r.tenant.slug, adminId: r.adminId, emailed: r.emailed }, ip: requestIp(req) });
    return NextResponse.json({ tenant: r.tenant, url: r.url, emailed: r.emailed }, { status: 201 });
  } catch (e) {
    if (e instanceof ConsoleAdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
