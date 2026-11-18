import type PgBoss from "pg-boss";
import { asPlatform, tenantDb } from "@/lib/db";
import type { JobData, QueueName } from "@/lib/jobs";

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
    const order = await tenantDb(tenantId).order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, totalAmount: true, retailer: { select: { outletName: true } } },
    });
    // Phase 7: WhatsApp / push confirmation to the retailer and the owner.
    console.log(`[event] order.placed ${order?.orderNumber} ${order?.retailer.outletName} ${order?.totalAmount}p`);
  },
  "order.status": logEvent,
  "order.delivered": logEvent,
  "retailer.registered": logEvent,
  "import.completed": logEvent,
  "otp.cleanup": async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const res = await asPlatform((tx) => tx.otpChallenge.deleteMany({ where: { createdAt: { lt: cutoff } } }));
    console.log(`[job] otp.cleanup removed ${res.count}`);
  },
};

export const schedules: { name: QueueName; cron: string }[] = [
  { name: "otp.cleanup", cron: "30 3 * * *" }, // 03:30 IST daily
];
