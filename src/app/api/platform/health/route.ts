import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asPlatform } from "@/lib/db";
import { platformGuard } from "@/lib/platform-auth";

/**
 * Platform health: database, background jobs (failed in the last day, oldest
 * waiting), and per business the things that went wrong in the last day
 * (messages failed, webhooks given up, e-invoices failed), overdue bills and
 * pending deletions.
 */
export async function GET() {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const day = new Date(Date.now() - 86_400_000);
  const t0 = Date.now();
  await prisma.$queryRaw`SELECT 1`;
  const dbMs = Date.now() - t0;

  let jobs: { failed24h: number; waiting: number; oldestWaitingMin: number | null } | null = null;
  try {
    const r = await prisma.$queryRaw<{ failed: bigint; waiting: bigint; oldest: Date | null }[]>`
      SELECT count(*) FILTER (WHERE state = 'failed' AND completed_on > now() - interval '1 day') AS failed,
             count(*) FILTER (WHERE state IN ('created', 'retry')) AS waiting,
             min(created_on) FILTER (WHERE state IN ('created', 'retry') AND start_after <= now()) AS oldest
        FROM pgboss.job`;
    const x = r[0];
    jobs = { failed24h: Number(x.failed), waiting: Number(x.waiting), oldestWaitingMin: x.oldest ? Math.round((Date.now() - x.oldest.getTime()) / 60_000) : null };
  } catch {
    jobs = null; // queue tables not there (worker never started)
  }

  const data = await asPlatform(async (tx) => {
    const [msg, hooks, einv, overdue, deleting, paused] = await Promise.all([
      tx.messageLog.groupBy({ by: ["tenantId"], where: { status: "FAILED", createdAt: { gte: day } }, _count: true }),
      tx.webhookDelivery.groupBy({ by: ["tenantId"], where: { status: "DEAD", createdAt: { gte: day } }, _count: true }),
      tx.invoice.groupBy({ by: ["tenantId"], where: { einvStatus: "FAILED" }, _count: true }),
      tx.platformInvoice.groupBy({ by: ["tenantId"], where: { status: "ISSUED", dueAt: { lte: new Date() } }, _sum: { total: true }, _count: true }),
      tx.tenant.findMany({ where: { deleteAfter: { not: null }, status: { not: "CLOSED" } }, select: { id: true, name: true, deleteAfter: true } }),
      tx.tenant.findMany({ where: { status: "SUSPENDED" }, select: { id: true, name: true, suspendReason: true, suspendedAt: true } }),
    ]);
    const ids = [...new Set([...msg, ...hooks, ...einv, ...overdue].map((r) => r.tenantId))];
    const names = await tx.tenant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, slug: true } });
    return { msg, hooks, einv, overdue, deleting, paused, names };
  });
  const name = new Map(data.names.map((n) => [n.id, n]));
  const issues = new Map<string, { tenantId: string; name: string; slug: string; messagesFailed: number; webhooksDead: number; einvoiceFailed: number; overduePaise: number }>();
  const row = (id: string) => {
    let r = issues.get(id);
    if (!r) issues.set(id, (r = { tenantId: id, name: name.get(id)?.name ?? id, slug: name.get(id)?.slug ?? "", messagesFailed: 0, webhooksDead: 0, einvoiceFailed: 0, overduePaise: 0 }));
    return r;
  };
  for (const r of data.msg) row(r.tenantId).messagesFailed = r._count;
  for (const r of data.hooks) row(r.tenantId).webhooksDead = r._count;
  for (const r of data.einv) row(r.tenantId).einvoiceFailed = r._count;
  for (const r of data.overdue) row(r.tenantId).overduePaise = r._sum.total ?? 0;
  return NextResponse.json({ db: { ok: true, ms: dbMs }, jobs, tenants: [...issues.values()], deleting: data.deleting, paused: data.paused });
}
