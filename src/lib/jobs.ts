import PgBoss from "pg-boss";

/**
 * Background jobs and domain events, queued in Postgres (pg-boss, schema
 * "pgboss") — no Redis to run. The web app only *sends*; the worker process
 * (npm run worker → scripts/worker.ts) does the work.
 *
 * Every job carries tenantId so handlers run inside that tenant's
 * row-level-security scope.
 */

export const QUEUES = {
  "order.placed": "An order was placed",
  "order.status": "An order changed status",
  "order.delivered": "An order was delivered",
  "retailer.registered": "A new retailer signed up",
  "import.completed": "A bulk import finished",
  "otp.cleanup": "Delete expired OTP challenges and old sign-in tries (daily)",
  "pings.cleanup": "Delete field-staff positions older than each business keeps them (daily)",
  "handoff.cleanup": "Delete used business-switch tokens older than a day (daily)",
  "einvoice.generate": "Get the IRN for a B2B invoice or note",
  "trip.started": "A trip left (retailers are told through order.status)",
  "messages.flush": "Send queued SMS / WhatsApp / push messages (after a change, and every minute)",
  "dues.reminders": "Payment reminders for overdue bills (daily 10:00)",
  "statements.monthly": "Monthly statements on the 1st (when turned on)",
  "tickets.sla": "Tell the office about complaints past their time (every 15 minutes)",
  "engage.daily": "Close resolved complaints, lapse old referrals, trim old notifications (daily)",
  "feedback.given": "A retailer rated a delivery",
  "gateway.sync": "Ask the gateway about open payment requests, in case a webhook was lost (every 10 minutes)",
  "webhooks.flush": "Send queued webhooks to the business's own software (after a change, and every minute)",
  "geo.locate": "Find map pins for shops from their address (after sign-up, and on request)",
  "tenant.export": "Make a full copy of a business's data (DPDP export)",
  "billing.daily": "Platform: trials, subscription invoices, reminders and pauses; deletions due; old exports (daily 06:00)",
  "reports.daily_summary": "The owner's daily summary, at each business's chosen hour (checked hourly)",
  "automation.daily": "Visit plans, collections, checks and expiry of old suggestions (06:00 IST)",
  "automation.weekly": "Credit review: risk scores and credit-limit suggestions (Mondays 06:30 IST)",
  "order.message": "Read an order a shop sent on WhatsApp and reply with a link to check it",
  "photos.check": "Check new payment, delivery, pickup and shelf photos: reuse, and what the AI reads (after an upload, and every 5 minutes)",
} as const;

export type QueueName = keyof typeof QUEUES;
export type JobData = { tenantId: string; [k: string]: unknown };

const g = globalThis as unknown as { __setuBoss?: Promise<PgBoss> };

export function bossFor(connectionString = process.env.DATABASE_URL ?? "") {
  return new PgBoss({ connectionString: connectionString.replace(/\?schema=[^&]*/, ""), schema: "pgboss" });
}

async function start(): Promise<PgBoss> {
  const boss = bossFor();
  boss.on("error", (e) => console.error("[jobs]", e));
  await boss.start();
  for (const name of Object.keys(QUEUES)) await boss.createQueue(name);
  return boss;
}

export function getBoss(): Promise<PgBoss> {
  g.__setuBoss ??= start().catch((e) => {
    g.__setuBoss = undefined;
    throw e;
  });
  return g.__setuBoss;
}

/**
 * Publish a domain event / enqueue a job. Never throws: a queue outage must
 * not fail the business action (the event is logged instead).
 */
export async function emit(name: QueueName, data: JobData, options?: PgBoss.SendOptions) {
  if (process.env.JOBS_DISABLED === "1") return null;
  try {
    const boss = await getBoss();
    return await boss.send(name, data, { retryLimit: 5, retryBackoff: true, ...options });
  } catch (e) {
    console.error(`[jobs] could not enqueue ${name}`, e);
    return null;
  }
}

/** Wake the message sender for one business soon (at most one waiting job per business). */
export function kickMessages(tenantId: string) {
  return emit("messages.flush", { tenantId }, { singletonKey: `flush:${tenantId}`, singletonSeconds: 3, retryLimit: 2 });
}

/** Check a business's new payment, delivery, pickup or shelf photos soon (at most one waiting job per business). */
export function kickPhotos(tenantId: string) {
  return emit("photos.check", { tenantId }, { singletonKey: `photos:${tenantId}`, singletonSeconds: 5, retryLimit: 2 });
}
