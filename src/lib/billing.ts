import { Prisma, type Plan, type PlatformInvoice } from "@/generated/prisma/client";
import { asPlatform, withTenantTx, type Tx } from "@/lib/db";
import { docNumber, fyCode, istParts, splitTax } from "@/lib/gst";
import { formatINR } from "@/lib/money";
import { notify, staffWith } from "@/lib/notify";
import { countSeats, invalidateEntitlements, parseLimits } from "@/lib/plans";
import { createLink, type RzpKeys } from "@/lib/razorpay";
import { invalidateTenantCache } from "@/lib/tenant";

/**
 * Subscription billing for tenants (Phase 9).
 *
 *  - Months run in Indian time. A tenant is billed in arrears at the end of
 *    each period for: the plan's flat fee, staff seats (active staff logins at
 *    the end of the period), active retailers (shops with an order in the
 *    period) and AI credits used over the plan's allowance.
 *  - The plan in force at the end of the period applies to the whole period.
 *  - Each invoice is our own GST tax invoice (SAC PLATFORM_SAC, 18 %): CGST +
 *    SGST when the tenant is in our state, IGST otherwise. Without
 *    PLATFORM_GSTIN set we are not registered and charge no GST.
 *  - Trial: TRIAL until trialEndsAt. If a plan was picked it starts then;
 *    otherwise the subscription is PAST_DUE and the business is paused after
 *    TRIAL_GRACE_DAYS.
 *  - Dunning: reminders when issued, on the due date, and 3 and 7 days after;
 *    the business is paused SUSPEND_AFTER_DAYS after the due date. Paying
 *    every overdue invoice un-pauses it.
 */

export const DUE_DAYS = 7;
export const TRIAL_GRACE_DAYS = 7;
export const SUSPEND_AFTER_DAYS = 14;
/** Reminder n is sent this many days after the due date (the first at issue). */
export const REMINDER_OFFSETS = [-DUE_DAYS, 0, 3, 7];
export const GST_RATE = 18;
const DAY = 86_400_000;
const IST_MS = 330 * 60 * 1000;

/** Our own details for invoices, from the environment. */
export function platformSeller() {
  return {
    legalName: process.env.PLATFORM_LEGAL_NAME || "Seller's Setu",
    gstin: process.env.PLATFORM_GSTIN || null,
    address: process.env.PLATFORM_ADDRESS || "",
    stateCode: process.env.PLATFORM_STATE_CODE || null,
    sac: process.env.PLATFORM_SAC || "997331",
  };
}

// ───────────────────────────── periods ─────────────────────────────

/** First instant of the IST calendar month that contains d, plus `add` months. */
export function istMonthStart(d: Date, add = 0) {
  const { y, m } = istParts(d);
  return new Date(Date.UTC(y, m - 1 + add, 1) - IST_MS);
}

/** Same day next month (clamped to the month's end), for periods that start mid-month. */
export function addMonth(d: Date, n = 1) {
  const t = new Date(d.getTime() + IST_MS);
  const day = t.getUTCDate();
  const target = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + n, 1, t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds()));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return new Date(target.getTime() - IST_MS);
}

/** "2026-11" — the usage counter period for a moment (IST). */
export function usagePeriod(d: Date) {
  const { y, m } = istParts(d);
  return `${y}-${String(m).padStart(2, "0")}`;
}

// ───────────────────────────── usage metering ─────────────────────────────

/** Add to a usage counter of the tenant for this month (ai_credits, messages, api_calls …). */
export async function meter(tx: Tx, tenantId: string, metric: string, n = 1, costPaise = 0, now = new Date()) {
  if (n <= 0 && costPaise <= 0) return;
  const period = usagePeriod(now);
  await tx.$executeRaw`
    INSERT INTO "UsageCounter" ("id", "tenantId", "period", "metric", "value", "costPaise", "updatedAt")
    VALUES (${`u_${tenantId}_${period}_${metric}`}, ${tenantId}, ${period}, ${metric}, ${Math.max(0, n)}, ${Math.max(0, costPaise)}, now())
    ON CONFLICT ("tenantId", "period", "metric")
    DO UPDATE SET "value" = "UsageCounter"."value" + EXCLUDED."value", "costPaise" = "UsageCounter"."costPaise" + EXCLUDED."costPaise", "updatedAt" = now()`;
}

export type Usage = { seats: number; retailers: number; aiCredits: number };

/** What a tenant used in [from, to). Runs inside a tenant-scoped transaction. */
export async function measureUsage(tx: Tx, from: Date, to: Date): Promise<Usage> {
  const [seats, shops, ai] = await Promise.all([
    countSeats(tx),
    tx.order.findMany({ where: { createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" } }, distinct: ["retailerId"], select: { retailerId: true } }),
    tx.usageCounter.findMany({ where: { metric: "ai_credits", period: usagePeriod(from) }, select: { value: true } }),
  ]);
  return { seats, retailers: shops.length, aiCredits: ai.reduce((s, r) => s + r.value, 0) };
}

// ───────────────────────────── the invoice maths (pure) ─────────────────────────────

export type BillLine = { code: string; description: string; sac: string; qty: number; ratePaise: number; amountPaise: number };

export function billLines(plan: Pick<Plan, "name" | "basePaise" | "seatPaise" | "retailerPaise" | "aiCredits" | "aiCreditPaise">, usage: Usage, sac: string): BillLine[] {
  const lines: BillLine[] = [];
  const add = (code: string, description: string, qty: number, rate: number) => {
    if (qty > 0 && rate > 0) lines.push({ code, description, sac, qty, ratePaise: rate, amountPaise: qty * rate });
  };
  add("base", `${plan.name} plan`, 1, plan.basePaise);
  add("seats", "Staff logins", usage.seats, plan.seatPaise);
  add("retailers", "Active shops", usage.retailers, plan.retailerPaise);
  add("ai", `AI credits over the ${plan.aiCredits} included`, Math.max(0, usage.aiCredits - plan.aiCredits), plan.aiCreditPaise);
  return lines;
}

export function billTax(taxable: number, buyerState: string | null, seller = platformSeller()) {
  if (!seller.gstin || taxable <= 0) return { interState: false, cgst: 0, sgst: 0, igst: 0, total: taxable };
  const interState = !seller.stateCode || !buyerState || buyerState !== seller.stateCode;
  const tax = Math.round((taxable * GST_RATE) / 100);
  return { interState, ...splitTax(tax, interState), total: taxable + tax };
}

// ───────────────────────────── issuing ─────────────────────────────

async function nextNumber(tx: Tx, at: Date) {
  const fy = fyCode(at);
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "PlatformCounter" ("key", "value") VALUES (${`SS/${fy}`}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "PlatformCounter"."value" + 1
    RETURNING "value"`;
  return { fy, number: docNumber("SS/", fy, Number(rows[0].value)) };
}

export function platformGatewayKeys(): RzpKeys | null {
  const keyId = process.env.PLATFORM_RAZORPAY_KEY_ID;
  const keySecret = process.env.PLATFORM_RAZORPAY_KEY_SECRET;
  return keyId && keySecret ? { keyId, keySecret } : null;
}

/**
 * Bill a tenant for [from, to). Idempotent: a second call for the same period
 * returns the first invoice. Returns null when there is nothing to charge.
 */
export async function issueInvoice(tenantId: string, from: Date, to: Date, now = new Date()): Promise<PlatformInvoice | null> {
  const seller = platformSeller();
  const inv = await withTenantTx(tenantId, async (tx) => {
    const existing = await tx.platformInvoice.findUnique({ where: { tenantId_periodStart: { tenantId, periodStart: from } } });
    if (existing) return existing;
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, legalName: true, gstin: true, address: true, stateCode: true } });
    const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } });
    const usage = await measureUsage(tx, from, to);
    const lines = billLines(sub.plan, usage, seller.sac);
    const taxable = lines.reduce((s, l) => s + l.amountPaise, 0);
    if (taxable <= 0) return null;
    const tax = billTax(taxable, tenant.stateCode, seller);
    const { fy, number } = await nextNumber(tx, now);
    return tx.platformInvoice.create({
      data: {
        tenantId,
        number,
        fy,
        periodStart: from,
        periodEnd: to,
        lines: lines as unknown as Prisma.InputJsonValue,
        billTo: { legalName: tenant.legalName || tenant.name, gstin: tenant.gstin, address: tenant.address, stateCode: tenant.stateCode },
        seller: { legalName: seller.legalName, gstin: seller.gstin, address: seller.address, stateCode: seller.stateCode },
        interState: tax.interState,
        taxable,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        total: tax.total,
        issuedAt: now,
        dueAt: new Date(now.getTime() + DUE_DAYS * DAY),
        remindersSent: 0,
      },
    });
  });
  if (!inv || inv.payUrl) return inv;
  return attachPayLink(inv);
}

/** A payment link on our own gateway account (when PLATFORM_RAZORPAY_* is set). Never fails the invoice. */
export async function attachPayLink(inv: PlatformInvoice): Promise<PlatformInvoice> {
  const keys = platformGatewayKeys();
  if (!keys || inv.status !== "ISSUED") return inv;
  try {
    const bill = inv.billTo as { legalName?: string };
    const link = await createLink(keys, {
      amount: inv.total,
      referenceId: inv.id,
      description: `Invoice ${inv.number}`,
      name: bill.legalName ?? "Customer",
      phone: null,
      expireBy: new Date(Math.max(inv.dueAt.getTime() + 30 * DAY, Date.now() + 16 * 60_000)),
      acceptPartial: false,
      callbackUrl: `${platformUrl()}/billing/paid`,
      notes: { setu_platform_invoice: inv.id },
    });
    return await withTenantTx(inv.tenantId, (tx) => tx.platformInvoice.update({ where: { id: inv.id }, data: { payLinkId: link.id, payUrl: link.short_url } }));
  } catch {
    return inv;
  }
}

export function platformUrl() {
  const domain = (process.env.PLATFORM_DOMAIN ?? "localhost").toLowerCase();
  const scheme = process.env.PUBLIC_SCHEME ?? (domain === "localhost" ? "http" : "https");
  const port = process.env.PUBLIC_PORT ? `:${process.env.PUBLIC_PORT}` : "";
  return `${scheme}://${domain === "localhost" ? "platform.localhost" : domain}${port}`;
}

async function tellOwners(tenantId: string, key: string, title: string, body: string) {
  await withTenantTx(tenantId, async (tx) => {
    const to = await staffWith(tx, "settings.manage");
    await notify(tx, tenantId, { event: "staff.billing", to, vars: { title, body }, link: "/admin/billing", key });
  });
}

/** Mark one of our invoices paid. Un-pauses the business when nothing is overdue any more. */
export async function markInvoicePaid(invoiceId: string, p: { ref?: string | null; via: string; at?: Date }) {
  const at = p.at ?? new Date();
  const inv = await asPlatform(async (tx) => {
    const cur = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (cur.status === "PAID") return cur;
    if (cur.status === "VOID") throw new BillingError("This invoice was voided");
    return tx.platformInvoice.update({ where: { id: invoiceId }, data: { status: "PAID", paidAt: at, paidRef: p.ref?.slice(0, 120) ?? null, paidVia: p.via.slice(0, 40) } });
  });
  await settleStanding(inv.tenantId, at);
  return inv;
}

export async function voidInvoice(invoiceId: string, reason: string) {
  if (!reason.trim()) throw new BillingError("Say why the invoice is voided");
  const inv = await asPlatform(async (tx) => {
    const cur = await tx.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (cur.status !== "ISSUED") throw new BillingError("Only an unpaid invoice can be voided");
    return tx.platformInvoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidReason: reason.trim().slice(0, 300) } });
  });
  await settleStanding(inv.tenantId, new Date());
  return inv;
}

/** After a payment or void: back to ACTIVE (and un-pause) when no invoice is overdue. */
async function settleStanding(tenantId: string, now: Date) {
  const changed = await asPlatform(async (tx) => {
    const overdue = await tx.platformInvoice.count({ where: { tenantId, status: "ISSUED", dueAt: { lte: now } } });
    if (overdue) return false;
    const sub = await tx.subscription.findUnique({ where: { tenantId } });
    if (!sub || !(sub.status === "PAST_DUE" || sub.status === "SUSPENDED") || sub.planCode === "trial") return false;
    await tx.subscription.update({ where: { tenantId }, data: { status: "ACTIVE" } });
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, suspendReason: true } });
    if (t.status === "SUSPENDED" && t.suspendReason?.startsWith("billing:")) {
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE", suspendedAt: null, suspendReason: null } });
    } else if (t.status === "TRIAL") {
      await tx.tenant.update({ where: { id: tenantId }, data: { status: "ACTIVE" } });
    }
    return true;
  });
  if (changed) {
    invalidateTenantCache(tenantId);
    invalidateEntitlements(tenantId);
  }
}

export class BillingError extends Error {}

// ───────────────────────────── plan changes ─────────────────────────────

/**
 * The owner picks a plan. In the trial it starts when the trial ends (and the
 * trial runs with its modules). After the trial it applies at once and the
 * whole current month is billed on it. A plan whose limits are below what is
 * in use is refused.
 */
export async function choosePlan(tenantId: string, code: string, now = new Date()) {
  const result = await withTenantTx(tenantId, async (tx) => {
    const plan = await tx.plan.findUnique({ where: { code } });
    // Hidden plans (negotiated prices) are given from the console, never picked by code here.
    if (!plan || !plan.active || !plan.public || code === "trial") throw new BillingError("Pick one of the plans on offer");
    const limits = parseLimits(plan.limits);
    const [seats, shops] = await Promise.all([countSeats(tx), tx.user.count({ where: { active: true, role: "RETAILER" } })]);
    if (limits.staff !== undefined && seats > limits.staff) throw new BillingError(`${plan.name} allows ${limits.staff} staff logins; ${seats} are active. Deactivate some first.`);
    if (limits.retailers !== undefined && shops > limits.retailers) throw new BillingError(`${plan.name} allows ${limits.retailers} shops; ${shops} are active.`);
    const sub = await tx.subscription.findUnique({ where: { tenantId } });
    if (!sub) {
      return tx.subscription.create({ data: { tenantId, planCode: code, status: "ACTIVE", periodStart: now, periodEnd: addMonth(now) } });
    }
    if (sub.status === "TRIAL") return tx.subscription.update({ where: { tenantId }, data: { nextPlanCode: code } });
    if (sub.status === "CANCELLED") throw new BillingError("This subscription was cancelled. Contact support to start again.");
    if (sub.planCode === "trial") {
      // Trial ended without a plan: the paid period starts now.
      return tx.subscription.update({ where: { tenantId }, data: { planCode: code, nextPlanCode: null, status: "ACTIVE", periodStart: now, periodEnd: addMonth(now) } });
    }
    // The month is billed on the plan held when it ends, so a cheaper plan starts with the next
    // month (else: top plan all month, switch the day before the bill). A dearer one starts now.
    const current = await tx.plan.findUnique({ where: { code: sub.planCode } });
    // "Cheaper" = a smaller monthly bill at today's staff and shops (rates alone mislead: a top plan can have a lower seat rate).
    const monthly = (p: Plan) => billLines(p, { seats, retailers: shops, aiCredits: 0 }, "").reduce((a, l) => a + l.amountPaise, 0);
    const cheaper = !!current && monthly(plan) < monthly(current);
    if (cheaper) return tx.subscription.update({ where: { tenantId }, data: { nextPlanCode: code === sub.planCode ? null : code } });
    return tx.subscription.update({ where: { tenantId }, data: { planCode: code, nextPlanCode: null } });
  });
  await asPlatform(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true, suspendReason: true } });
    const data: Prisma.TenantUpdateInput = { plan: result.status === "TRIAL" ? "trial" : result.planCode };
    if (t.status === "SUSPENDED" && t.suspendReason === "billing:trial-ended" && result.status === "ACTIVE") Object.assign(data, { status: "ACTIVE", suspendedAt: null, suspendReason: null });
    else if (t.status === "TRIAL" && result.status === "ACTIVE") data.status = "ACTIVE";
    await tx.tenant.update({ where: { id: tenantId }, data });
  });
  invalidateTenantCache(tenantId);
  invalidateEntitlements(tenantId);
  return result;
}

/** Start the trial for a new tenant (sign-up, CLI, seed). */
export async function startTrial(tx: Tx, tenantId: string, now = new Date(), planCode: string | null = null) {
  const trial = await tx.plan.findUnique({ where: { code: "trial" } });
  const days = trial?.trialDays ?? 14;
  const ends = new Date(now.getTime() + days * DAY);
  return tx.subscription.create({
    data: { tenantId, planCode: "trial", nextPlanCode: planCode, status: "TRIAL", trialEndsAt: ends, periodStart: now, periodEnd: ends },
  });
}

// ───────────────────────────── the daily run ─────────────────────────────

export type BillingRun = { trialsConverted: number; trialsLapsed: number; invoiced: number; reminders: number; suspended: number };

/** Trials, invoices and dunning for every tenant. Safe to run more than once a day. */
export async function runBilling(now = new Date(), only?: string[]): Promise<BillingRun> {
  const out: BillingRun = { trialsConverted: 0, trialsLapsed: 0, invoiced: 0, reminders: 0, suspended: 0 };
  // `only`: these tenants (tests run the clock forward without touching the demo data).
  const scope = only ? { tenantId: { in: only } } : {};
  const subs = await asPlatform((tx) =>
    tx.subscription.findMany({ where: { ...scope, tenant: { status: { not: "CLOSED" } }, status: { not: "CANCELLED" } }, include: { tenant: { select: { status: true, suspendReason: true, name: true } } } })
  );

  for (const sub of subs) {
    const tenantId = sub.tenantId;
    // 1. Trials
    if (sub.status === "TRIAL" && sub.trialEndsAt && sub.trialEndsAt <= now) {
      if (sub.nextPlanCode) {
        await asPlatform(async (tx) => {
          await tx.subscription.update({ where: { tenantId }, data: { planCode: sub.nextPlanCode!, nextPlanCode: null, status: "ACTIVE", periodStart: sub.trialEndsAt!, periodEnd: addMonth(sub.trialEndsAt!) } });
          await tx.tenant.update({ where: { id: tenantId }, data: { plan: sub.nextPlanCode!, ...(sub.tenant.status === "TRIAL" ? { status: "ACTIVE" } : {}) } });
        });
        out.trialsConverted++;
        await tellOwners(tenantId, `billing.trial-converted:${sub.id}`, "Your plan has started", "Your free trial ended and your plan is now active.");
      } else {
        await asPlatform((tx) => tx.subscription.update({ where: { tenantId }, data: { status: "PAST_DUE" } }));
        out.trialsLapsed++;
        await tellOwners(tenantId, `billing.trial-ended:${sub.id}`, "Your free trial has ended", `Pick a plan within ${TRIAL_GRACE_DAYS} days to keep using the app.`);
      }
      invalidateEntitlements(tenantId);
      continue;
    }
    if (sub.status === "PAST_DUE" && sub.planCode === "trial" && sub.trialEndsAt && sub.trialEndsAt.getTime() + TRIAL_GRACE_DAYS * DAY <= now.getTime()) {
      if (sub.tenant.status !== "SUSPENDED") {
        await suspendForBilling(tenantId, "billing:trial-ended");
        out.suspended++;
      }
      continue;
    }

    // 2. Period end → invoice (catch up if the job was down).
    let cur = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId } }));
    while (cur.planCode !== "trial" && cur.status !== "TRIAL" && cur.periodEnd <= now) {
      const inv = await issueInvoice(tenantId, cur.periodStart, cur.periodEnd, now);
      if (inv) out.invoiced++;
      const nextStart = cur.periodEnd;
      const switchTo = cur.status === "ACTIVE" ? cur.nextPlanCode : null;
      cur = await asPlatform(async (tx) => {
        const s = await tx.subscription.update({ where: { tenantId }, data: { periodStart: nextStart, periodEnd: addMonth(nextStart), ...(switchTo ? { planCode: switchTo, nextPlanCode: null } : {}) } });
        if (switchTo) await tx.tenant.update({ where: { id: tenantId }, data: { plan: switchTo } });
        return s;
      });
      if (switchTo) invalidateEntitlements(tenantId);
    }
  }

  // 3. Dunning on unpaid invoices.
  const unpaid = await asPlatform((tx) => tx.platformInvoice.findMany({ where: { ...scope, status: "ISSUED" }, orderBy: { dueAt: "asc" } }));
  for (const inv of unpaid) {
    const step = inv.remindersSent;
    if (step < REMINDER_OFFSETS.length && now.getTime() >= inv.dueAt.getTime() + REMINDER_OFFSETS[step] * DAY) {
      const overdue = now >= inv.dueAt;
      await asPlatform((tx) => tx.platformInvoice.update({ where: { id: inv.id }, data: { remindersSent: step + 1, lastReminderAt: now } }));
      await tellOwners(
        inv.tenantId,
        `billing.reminder:${inv.id}:${step}`,
        overdue ? `Invoice ${inv.number} is overdue` : `Invoice ${inv.number}`,
        `${formatINR(inv.total)} ${overdue ? "was due" : "is due"} on ${inv.dueAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}. Pay from Billing to avoid a pause.`
      );
      out.reminders++;
    }
    if (now >= inv.dueAt) {
      await asPlatform((tx) => tx.subscription.updateMany({ where: { tenantId: inv.tenantId, status: "ACTIVE" }, data: { status: "PAST_DUE" } }));
    }
    if (now.getTime() >= inv.dueAt.getTime() + SUSPEND_AFTER_DAYS * DAY) {
      const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: inv.tenantId }, select: { status: true } }));
      if (t.status !== "SUSPENDED") {
        await suspendForBilling(inv.tenantId, `billing:unpaid ${inv.number}`);
        out.suspended++;
      }
    }
  }
  return out;
}

async function suspendForBilling(tenantId: string, reason: string) {
  await asPlatform(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { status: "SUSPENDED", suspendedAt: new Date(), suspendReason: reason } });
    await tx.subscription.updateMany({ where: { tenantId }, data: { status: "SUSPENDED" } });
  });
  invalidateTenantCache(tenantId);
  invalidateEntitlements(tenantId);
  await tellOwners(tenantId, `billing.suspended:${reason}:${new Date().toISOString().slice(0, 10)}`, "Your business is paused", "Shops and staff can't use the app until the bill is paid. Open Billing to pay.");
}
