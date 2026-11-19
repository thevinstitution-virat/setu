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
  "otp.cleanup": "Delete expired OTP challenges (daily)",
  "einvoice.generate": "Get the IRN for a B2B invoice or note",
  "trip.started": "A trip left: tell each retailer (Phase 7 notifications)",
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
