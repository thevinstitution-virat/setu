/**
 * Phase 9 demo: the plans, a subscription for each tenant, the platform
 * console's own logins, last month's bill for the demo business (paid) and
 * one announcement.
 *
 *   demo   → Growth plan, ACTIVE; last month's invoice issued and paid.
 *   second → free trial, 9 days left, Starter picked for after the trial.
 *
 * Console (platform address, dev: http://platform.localhost:3100/platform):
 *   owner@setu.local / platform123 (OWNER) · support@setu.local / platform123 (SUPPORT)
 * These are local test logins only; production console users are made with
 * scripts/platform-user.ts.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_PLANS } from "../src/lib/plans";
import { hashPassword } from "../src/lib/password";
import { addMonth, istMonthStart, issueInvoice, markInvoicePaid, meter, usagePeriod } from "../src/lib/billing";
import { withTenantTx } from "../src/lib/db";

const DAY = 86_400_000;

export const PLATFORM_LOGINS = [
  { name: "Platform owner", email: "owner@setu.local", role: "OWNER" as const },
  { name: "Support desk", email: "support@setu.local", role: "SUPPORT" as const },
];
export const PLATFORM_TEST_PASSWORD = "platform123";

export async function seedSaas(prisma: PrismaClient) {
  for (const p of DEFAULT_PLANS) {
    const data = { ...p, features: [...p.features], limits: { ...p.limits } };
    await prisma.plan.upsert({ where: { code: p.code }, create: data, update: data });
  }

  for (const u of PLATFORM_LOGINS) {
    await prisma.platformUser.upsert({
      where: { email: u.email },
      create: { ...u, passwordHash: hashPassword(PLATFORM_TEST_PASSWORD) },
      update: { role: u.role, active: true },
    });
  }

  const now = new Date();
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } });
  const second = await prisma.tenant.findUniqueOrThrow({ where: { slug: "second" } });

  // demo: on Growth since last month, billed in arrears.
  const thisMonth = istMonthStart(now);
  const lastMonth = istMonthStart(now, -1);
  await withTenantTx(demo.id, (tx) =>
    tx.subscription.create({
      data: { tenantId: demo.id, planCode: "growth", status: "ACTIVE", periodStart: lastMonth, periodEnd: thisMonth, billingEmail: "accounts@demo.example" },
    })
  );
  const inv = await issueInvoice(demo.id, lastMonth, thisMonth, new Date(thisMonth.getTime() + DAY));
  if (inv) await markInvoicePaid(inv.id, { ref: "DEMO-UTR-0001", via: "bank transfer", at: new Date(thisMonth.getTime() + 3 * DAY) });
  await withTenantTx(demo.id, async (tx) => {
    await tx.subscription.update({ where: { tenantId: demo.id }, data: { periodStart: thisMonth, periodEnd: addMonth(thisMonth) } });
    await meter(tx, demo.id, "api_calls", 1240, 0, now);
    await meter(tx, demo.id, "ai_credits", 37, 410, now);
  });
  await prisma.tenant.update({ where: { id: demo.id }, data: { plan: "growth", status: "ACTIVE" } });

  // second: in its trial, Starter picked.
  await withTenantTx(second.id, (tx) =>
    tx.subscription.create({
      data: { tenantId: second.id, planCode: "trial", nextPlanCode: "starter", status: "TRIAL", trialEndsAt: new Date(now.getTime() + 9 * DAY), periodStart: new Date(now.getTime() - 5 * DAY), periodEnd: new Date(now.getTime() + 9 * DAY) },
    })
  );
  await prisma.tenant.update({ where: { id: second.id }, data: { status: "TRIAL", plan: "trial" } });

  const owner = await prisma.platformUser.findUniqueOrThrow({ where: { email: PLATFORM_LOGINS[0].email } });
  await prisma.platformAnnouncement.create({
    data: {
      title: "New: your own brand",
      body: "You can now add your logo and colours under Settings → Brand. Shops see them on the app and on invoices.",
      level: "info",
      audience: "ADMINS",
      startsAt: new Date(now.getTime() - DAY),
      endsAt: new Date(now.getTime() + 14 * DAY),
      createdById: owner.id,
    },
  });

  return { invoice: inv?.number ?? null, period: usagePeriod(lastMonth) };
}
