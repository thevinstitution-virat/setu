/**
 * Background worker: `npm run worker`. Run one (or more) next to the web app.
 * On Coolify this is a second service from the same image with this command.
 */
import "dotenv/config";
import { getBoss } from "../src/lib/jobs";
import { handlers, schedules } from "../src/jobs/handlers";
import { sendAlert } from "../src/lib/alerts";
import { reportServerError } from "../src/lib/error-report-server";

async function main() {
  const boss = await getBoss();

  for (const [name, handler] of Object.entries(handlers)) {
    await boss.work(name, { batchSize: 5 }, async (jobs) => {
      for (const job of jobs) {
        try {
          await handler!(job as never);
        } catch (e) {
          await reportServerError(e, { source: "worker", job: name });
          await sendAlert(`Job ${name} failed`, e instanceof Error ? e.message : String(e));
          throw e; // pg-boss retries with backoff
        }
      }
    });
  }
  for (const s of schedules) {
    await boss.schedule(s.name, s.cron, { tenantId: "platform" }, { tz: "Asia/Kolkata" });
  }

  console.log(`[worker] listening on ${Object.keys(handlers).length} queues`);

  const stop = async () => {
    console.log("[worker] stopping…");
    await boss.stop({ graceful: true, timeout: 20_000 });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
