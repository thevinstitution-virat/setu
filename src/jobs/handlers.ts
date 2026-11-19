import type PgBoss from "pg-boss";
import { asPlatform } from "@/lib/db";
import type { JobData, QueueName } from "@/lib/jobs";
import { generateEInvoice } from "@/lib/einvoice";
import { MoneyError } from "@/lib/money-error";
import { withMoney } from "@/lib/ledger";
import { purgePings } from "@/lib/field";
import { emit, kickMessages } from "@/lib/jobs";
import { flushAll, flushTenant } from "@/lib/outbox";
import {
  duesReminders,
  monthlyStatements,
  onOrderDeliveredNotify,
  onOrderPlacedNotify,
  onOrderStatusNotify,
} from "@/lib/notify-flows";
import { autoClose, slaSweep } from "@/lib/tickets";
import { lapseReferrals, qualifyReferral } from "@/lib/referrals";
import { syncOpen } from "@/lib/gateway";
import { flushAllWebhooks, flushWebhooks, orderWebhook, retailerWebhook } from "@/lib/webhooks";
import { locateShops } from "@/lib/maps";

/**
 * Worker-side handlers. Phase 0 keeps them small (logging, housekeeping);
 * later phases hang notifications (Phase 7), ledger postings (Phase 1) and
 * AI suggestions (§7) on the same events without touching the routes.
 */

type Handler = (job: PgBoss.Job<JobData>) => Promise<void>;

const logEvent: Handler = async (job) => {
  console.log(`[event] ${job.name}`, JSON.stringify(job.data));
};

export const handlers: Partial<Record<QueueName, Handler>> = {
  "order.placed": async (job) => {
    const { tenantId, orderId } = job.data as JobData & { orderId: string };
    await withMoney(tenantId, null, async (ctx) => {
      await onOrderPlacedNotify(ctx.tx, tenantId, orderId);
      await orderWebhook(ctx.tx, tenantId, orderId, "order.placed");
    });
  },
  "order.status": async (job) => {
    const { tenantId, orderId, from, to } = job.data as JobData & { orderId: string; from: string; to: string };
    await withMoney(tenantId, null, async (ctx) => {
      await onOrderStatusNotify(ctx.tx, tenantId, orderId, from, to);
      await orderWebhook(ctx.tx, tenantId, orderId, "order.status_changed", from);
    });
  },
  "order.delivered": async (job) => {
    const { tenantId, orderId } = job.data as JobData & { orderId: string };
    await withMoney(tenantId, null, async (ctx) => {
      await onOrderDeliveredNotify(ctx.tx, tenantId, orderId);
      await qualifyReferral(ctx, orderId);
      await orderWebhook(ctx.tx, tenantId, orderId, "order.status_changed", "OUT_FOR_DELIVERY");
    });
  },
  "retailer.registered": async (job) => {
    const { tenantId, userId } = job.data as JobData & { userId: string };
    const shop = await withMoney(tenantId, null, async (ctx) => {
      const r = await ctx.tx.retailerProfile.findUnique({ where: { userId }, select: { id: true, lat: true } });
      if (r) await retailerWebhook(ctx.tx, tenantId, r.id);
      return r;
    });
    if (shop && shop.lat == null) await emit("geo.locate", { tenantId, retailerIds: [shop.id] });
  },
  "import.completed": logEvent,
  "einvoice.generate": async (job) => {
    const { tenantId, invoiceId } = job.data as JobData & { invoiceId: string };
    try {
      await generateEInvoice(tenantId, invoiceId);
    } catch (e) {
      // Data problems (missing PIN, HSN …) won't fix themselves: stored on the invoice, no retry.
      if (e instanceof MoneyError && e.status < 500) return;
      throw e;
    }
  },
  "otp.cleanup": async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await asPlatform((tx) => tx.otpChallenge.deleteMany({ where: { createdAt: { lt: cutoff } } }));
    console.log(`[job] otp.cleanup removed ${res.count}`);
  },
  "pings.cleanup": async () => {
    // Each business keeps positions for its own retention period (Settings -> Field team).
    const tenants = await asPlatform((tx) => tx.tenant.findMany({ select: { id: true } }));
    let total = 0;
    for (const t of tenants) total += await withMoney(t.id, null, (ctx) => purgePings(ctx));
    console.log(`[job] pings.cleanup removed ${total}`);
  },
  "messages.flush": async (job) => {
    const { tenantId } = job.data;
    const r = tenantId && tenantId !== "platform" ? await flushTenant(tenantId) : await flushAll();
    if (r.SENT + r.FAILED + r.LOGGED + r.SKIPPED) console.log(`[job] messages.flush ${tenantId}`, JSON.stringify(r));
  },
  "dues.reminders": async () => {
    for (const t of await tenants()) {
      const n = await withMoney(t, null, (ctx) => duesReminders(ctx.tx, t));
      if (n) console.log(`[job] dues.reminders ${t}: ${n}`);
    }
  },
  "statements.monthly": async () => {
    for (const t of await tenants()) await withMoney(t, null, (ctx) => monthlyStatements(ctx.tx, t));
  },
  "tickets.sla": async () => {
    for (const t of await tenants()) await withMoney(t, null, (ctx) => slaSweep(ctx.tx, t));
  },
  "engage.daily": async () => {
    const old = new Date(Date.now() - 90 * 24 * 3600_000);
    for (const t of await tenants()) {
      await withMoney(t, null, async (ctx) => {
        await autoClose(ctx.tx, t);
        await lapseReferrals(ctx.tx);
        // Read notifications go after 90 days; the message log keeps a year.
        await ctx.tx.notification.deleteMany({ where: { readAt: { lt: old } } });
        await ctx.tx.messageLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 365 * 24 * 3600_000) } } });
      });
      await kickMessages(t);
    }
  },
  "gateway.sync": async () => {
    for (const t of await tenants()) {
      const n = await syncOpen(t);
      if (n) console.log(`[job] gateway.sync ${t}: recorded ${n}`);
    }
  },
  "webhooks.flush": async (job) => {
    const { tenantId } = job.data;
    if (tenantId && tenantId !== "platform") {
      const r = await flushWebhooks(tenantId);
      if (r.sent + r.failed + r.dead) console.log(`[job] webhooks.flush ${tenantId}`, JSON.stringify(r));
    } else await flushAllWebhooks();
  },
  "geo.locate": async (job) => {
    const { tenantId, retailerIds } = job.data as JobData & { retailerIds?: string[] };
    const r = await locateShops(tenantId, Array.isArray(retailerIds) ? retailerIds : undefined);
    if (r.tried) console.log(`[job] geo.locate ${tenantId}`, JSON.stringify(r));
  },
  "handoff.cleanup": async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await asPlatform((tx) => tx.handoffUse.deleteMany({ where: { usedAt: { lt: cutoff } } }));
    console.log(`[job] handoff.cleanup removed ${res.count}`);
  },
};

async function tenants() {
  return (await asPlatform((tx) => tx.tenant.findMany({ select: { id: true } }))).map((t) => t.id);
}

export const schedules: { name: QueueName; cron: string }[] = [
  { name: "messages.flush", cron: "* * * * *" }, // sweep: anything queued or worth retrying
  { name: "tickets.sla", cron: "*/15 * * * *" },
  { name: "gateway.sync", cron: "*/10 * * * *" },
  { name: "webhooks.flush", cron: "* * * * *" }, // sweep: retries that are due
  { name: "dues.reminders", cron: "0 10 * * *" }, // 10:00 IST
  { name: "statements.monthly", cron: "0 9 1 * *" }, // 09:00 IST on the 1st
  { name: "engage.daily", cron: "15 4 * * *" },
  { name: "otp.cleanup", cron: "30 3 * * *" }, // 03:30 IST daily
  { name: "pings.cleanup", cron: "45 3 * * *" },
  { name: "handoff.cleanup", cron: "50 3 * * *" },
];
