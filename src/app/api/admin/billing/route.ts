import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { BillingError, billLines, choosePlan, measureUsage, platformSeller, billTax } from "@/lib/billing";
import { countRetailers, countSeats, entitlements, FEATURES, FEATURE_KEYS, isFeature, parseLimits } from "@/lib/plans";

/**
 * Plan and billing for the owner: current plan and status, modules, limits
 * and what is used, this month's estimate, our invoices, and the plans on offer.
 */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { tenant } = auth;
  const now = new Date();
  const e = await entitlements(tenant.id);
  const data = await withTenantTx(tenant.id, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { tenantId: tenant.id }, include: { plan: true } });
    const [seats, retailers, invoices] = await Promise.all([
      countSeats(tx),
      countRetailers(tx),
      tx.platformInvoice.findMany({ orderBy: { issuedAt: "desc" }, take: 24 }),
    ]);
    const estimate = sub && sub.status !== "TRIAL" && sub.planCode !== "trial" ? await measureUsage(tx, sub.periodStart, now) : null;
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { stateCode: true } });
    return { sub, seats, retailers, invoices, estimate, stateCode: t.stateCode };
  });
  const plans = await prisma.plan.findMany({ where: { active: true, public: true }, orderBy: { sortOrder: "asc" } });
  const seller = platformSeller();
  let estimate = null;
  if (data.sub && data.estimate) {
    const lines = billLines(data.sub.plan, data.estimate, seller.sac);
    const taxable = lines.reduce((s, l) => s + l.amountPaise, 0);
    estimate = { lines, taxable, ...billTax(taxable, data.stateCode, seller), usage: data.estimate };
  }
  return NextResponse.json({
    subscription: data.sub && {
      status: data.sub.status,
      planCode: data.sub.planCode,
      planName: data.sub.plan.name,
      nextPlanCode: data.sub.nextPlanCode,
      trialEndsAt: data.sub.trialEndsAt,
      periodStart: data.sub.periodStart,
      periodEnd: data.sub.periodEnd,
    },
    tenantStatus: tenant.status,
    pausedReason: tenant.status === "SUSPENDED" ? tenant.suspendReason : null,
    modules: FEATURE_KEYS.map((f) => ({ code: f, label: FEATURES[f], on: e.features.has(f) })),
    limits: { staff: { limit: e.limits.staff ?? null, used: data.seats }, retailers: { limit: e.limits.retailers ?? null, used: data.retailers } },
    estimate,
    gstRegistered: !!seller.gstin,
    invoices: data.invoices.map((i) => ({ id: i.id, number: i.number, issuedAt: i.issuedAt, dueAt: i.dueAt, periodStart: i.periodStart, periodEnd: i.periodEnd, total: i.total, status: i.status, paidAt: i.paidAt, payUrl: i.status === "ISSUED" ? i.payUrl : null, overdue: i.status === "ISSUED" && i.dueAt <= now })),
    plans: plans.map((p) => ({ code: p.code, name: p.name, basePaise: p.basePaise, seatPaise: p.seatPaise, retailerPaise: p.retailerPaise, aiCredits: p.aiCredits, aiCreditPaise: p.aiCreditPaise, limits: parseLimits(p.limits), features: p.features.filter(isFeature) })),
  });
}

/** Body: { planCode } — pick a plan (in the trial it starts when the trial ends). */
export async function POST(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  if (auth.session.supportId) return NextResponse.json({ error: "Support can't change the plan. Ask the owner." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const code = typeof body?.planCode === "string" ? body.planCode : "";
  try {
    const sub = await choosePlan(auth.tenant.id, code);
    await audit(auth.db, { actorId: auth.session.userId, action: "billing.plan", entity: "Subscription", entityId: sub.id, after: { planCode: sub.planCode, nextPlanCode: sub.nextPlanCode, status: sub.status }, ip: requestIp(req) });
    return NextResponse.json({ ok: true, status: sub.status, planCode: sub.planCode, nextPlanCode: sub.nextPlanCode });
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
