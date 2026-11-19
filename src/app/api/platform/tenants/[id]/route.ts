import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { asPlatform } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { entitlements, FEATURE_KEYS, FEATURES, invalidateEntitlements, isFeature, parseLimits, parseOverrides, type Overrides } from "@/lib/plans";
import { invalidateTenantCache } from "@/lib/tenant";
import { LifecycleError, setSuspended } from "@/lib/tenant-data";
import { usagePeriod } from "@/lib/billing";
import type { Prisma } from "@/generated/prisma/client";

/** One business in full: details, subscription, modules, usage, domains, invoices, support sessions, health. */
export async function GET(_req: Request, ctx: RouteContext<"/api/platform/tenants/[id]">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const t = await prisma.tenant.findUnique({
    where: { id },
    select: { id: true, slug: true, name: true, legalName: true, gstin: true, stateCode: true, address: true, phone: true, status: true, plan: true, overrides: true, suspendedAt: true, suspendReason: true, deleteRequestedAt: true, deleteAfter: true, closedAt: true, createdAt: true, brand: true },
  });
  if (!t) return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const day = new Date(Date.now() - 86_400_000);
  const data = await asPlatform(async (tx) => {
    const [sub, domains, invoices, sessions, usage, staff, retailers, orders30, lastOrder, msgFailed, hooksDead, einvFailed, exports] = await Promise.all([
      tx.subscription.findUnique({ where: { tenantId: id }, include: { plan: { select: { name: true } } } }),
      tx.tenantDomain.findMany({ where: { tenantId: id }, orderBy: { createdAt: "asc" } }),
      tx.platformInvoice.findMany({ where: { tenantId: id }, orderBy: { issuedAt: "desc" }, take: 24 }),
      tx.supportSession.findMany({ where: { tenantId: id }, orderBy: { startedAt: "desc" }, take: 20, include: { platformUser: { select: { name: true } } } }),
      tx.usageCounter.findMany({ where: { tenantId: id }, orderBy: { period: "desc" }, take: 36 }),
      tx.user.count({ where: { tenantId: id, active: true, isSupport: false, role: { not: "RETAILER" } } }),
      tx.user.count({ where: { tenantId: id, active: true, role: "RETAILER" } }),
      tx.order.count({ where: { tenantId: id, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
      tx.order.findFirst({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      tx.messageLog.count({ where: { tenantId: id, status: "FAILED", createdAt: { gte: day } } }),
      tx.webhookDelivery.count({ where: { tenantId: id, status: "DEAD", createdAt: { gte: day } } }),
      tx.invoice.count({ where: { tenantId: id, einvStatus: "FAILED" } }),
      tx.tenantExport.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
    ]);
    return { sub, domains, invoices, sessions, usage, staff, retailers, orders30, lastOrder, msgFailed, hooksDead, einvFailed, exports };
  });
  const e = t.status === "CLOSED" ? null : await entitlements(id);
  return NextResponse.json({
    tenant: t,
    subscription: data.sub,
    modules: FEATURE_KEYS.map((f) => ({ code: f, label: FEATURES[f], on: !!e?.features.has(f), override: parseOverrides(t.overrides).features?.[f] ?? null })),
    limits: { staff: { limit: e?.limits.staff ?? null, used: data.staff }, retailers: { limit: e?.limits.retailers ?? null, used: data.retailers } },
    usage: data.usage,
    thisPeriod: usagePeriod(new Date()),
    domains: data.domains,
    invoices: data.invoices,
    supportSessions: data.sessions.map((s) => ({ ...s, by: s.platformUser.name })),
    exports: data.exports.map((x) => ({ id: x.id, status: x.status, createdAt: x.createdAt, rows: x.rows, bytes: x.bytes, forDeletion: x.forDeletion })),
    health: { orders30d: data.orders30, lastOrderAt: data.lastOrder?.createdAt ?? null, messagesFailed24h: data.msgFailed, webhooksDead24h: data.hooksDead, einvoiceFailed: data.einvFailed },
  });
}

/**
 * Change a business. Body (any of):
 *   planCode            — move to a plan now (OWNER)
 *   extendTrialDays     — add days to the trial (1–60)
 *   overrides           — { features: { inventory: true|false|null }, limits: { staff: n|null, retailers: n|null } } (OWNER)
 *   suspend: { reason } / reactivate: true
 */
export async function PATCH(req: Request, ctx: RouteContext<"/api/platform/tenants/[id]">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Send the change as JSON" }, { status: 400 });
  const t = await prisma.tenant.findUnique({ where: { id }, select: { status: true, overrides: true } });
  if (!t || t.status === "CLOSED") return NextResponse.json({ error: "Business not found" }, { status: 404 });
  const owner = g.session.role === "OWNER";
  const ip = requestIp(req);
  const done: string[] = [];

  try {
    if (typeof body.planCode === "string") {
      if (!owner) return NextResponse.json({ error: "Only the platform owner can change plans" }, { status: 403 });
      const plan = await prisma.plan.findUnique({ where: { code: body.planCode } });
      if (!plan) return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
      await asPlatform(async (tx) => {
        const sub = await tx.subscription.findUnique({ where: { tenantId: id } });
        const now = new Date();
        if (!sub) await tx.subscription.create({ data: { tenantId: id, planCode: plan.code, status: "ACTIVE", periodStart: now, periodEnd: new Date(now.getTime() + 30 * 86_400_000) } });
        else if (sub.status === "TRIAL" && plan.code !== "trial") await tx.subscription.update({ where: { tenantId: id }, data: { nextPlanCode: plan.code } });
        else await tx.subscription.update({ where: { tenantId: id }, data: { planCode: plan.code, nextPlanCode: null } });
        await tx.tenant.update({ where: { id }, data: { plan: sub?.status === "TRIAL" ? "trial" : plan.code } });
      });
      done.push(`plan → ${plan.code}`);
    }
    if (body.extendTrialDays !== undefined) {
      const days = Number(body.extendTrialDays);
      if (!Number.isInteger(days) || days < 1 || days > 60) return NextResponse.json({ error: "Extend by 1–60 days" }, { status: 400 });
      await asPlatform(async (tx) => {
        const sub = await tx.subscription.findUnique({ where: { tenantId: id } });
        if (!sub || !(sub.status === "TRIAL" || (sub.status === "PAST_DUE" && sub.planCode === "trial") || (sub.status === "SUSPENDED" && sub.planCode === "trial"))) throw new LifecycleError("Only a trial can be extended");
        const base = sub.trialEndsAt && sub.trialEndsAt > new Date() ? sub.trialEndsAt : new Date();
        const ends = new Date(base.getTime() + days * 86_400_000);
        await tx.subscription.update({ where: { tenantId: id }, data: { status: "TRIAL", trialEndsAt: ends, periodEnd: ends } });
        const cur = await tx.tenant.findUniqueOrThrow({ where: { id }, select: { status: true, suspendReason: true } });
        if (cur.status === "SUSPENDED" && cur.suspendReason === "billing:trial-ended") await tx.tenant.update({ where: { id }, data: { status: "TRIAL", suspendedAt: null, suspendReason: null } });
      });
      done.push(`trial +${days}d`);
    }
    if (body.overrides && typeof body.overrides === "object") {
      if (!owner) return NextResponse.json({ error: "Only the platform owner can change modules and limits" }, { status: 403 });
      const cur = parseOverrides(t.overrides);
      const inp = body.overrides as { features?: Record<string, unknown>; limits?: Record<string, unknown> };
      const next: Overrides = { features: { ...cur.features }, limits: { ...cur.limits } };
      for (const [k, v] of Object.entries(inp.features ?? {})) {
        if (!isFeature(k)) continue;
        if (v === null) delete next.features![k];
        else if (typeof v === "boolean") next.features![k] = v;
      }
      for (const k of ["staff", "retailers"] as const) {
        if (!inp.limits || !(k in inp.limits)) continue;
        if (inp.limits[k] === null) delete next.limits![k];
        else {
          const lim = parseLimits({ [k]: inp.limits[k] })[k];
          if (lim === undefined) return NextResponse.json({ error: `Limit ${k} must be a whole number` }, { status: 400 });
          next.limits![k] = lim;
        }
      }
      await asPlatform((tx) => tx.tenant.update({ where: { id }, data: { overrides: next as Prisma.InputJsonValue } }));
      done.push("overrides");
    }
    if (body.suspend && typeof body.suspend === "object") {
      await setSuspended(id, true, String((body.suspend as { reason?: unknown }).reason ?? ""));
      done.push("suspended");
    } else if (body.reactivate === true) {
      await setSuspended(id, false, null);
      done.push("reactivated");
    }
  } catch (e) {
    if (e instanceof LifecycleError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (!done.length) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  invalidateTenantCache(id);
  invalidateEntitlements(id);
  await platformAudit(g.session.platformUserId, "tenant.update", { tenantId: id, detail: { done, body: body as Prisma.InputJsonValue }, ip });
  return NextResponse.json({ ok: true, done });
}
