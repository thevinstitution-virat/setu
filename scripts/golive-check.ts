/**
 * Go-live readiness: `npm run golive:check` on the server (with its environment).
 * Prints every check; exits 1 when one fails. See src/lib/golive.ts.
 */
import "dotenv/config";
import { goLiveReport } from "../src/lib/golive";
import { prisma } from "../src/lib/prisma";

const MARK = { ok: "  ok ", warn: " warn", fail: " FAIL" } as const;

goLiveReport()
  .then(async (r) => {
    for (const c of r.checks) console.log(`${MARK[c.status]}  ${c.label}: ${c.detail}`);
    console.log(`\n${r.fails} failing, ${r.warnings} to look at, ${r.checks.length - r.fails - r.warnings} fine.`);
    await prisma.$disconnect();
    process.exit(r.fails ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("Couldn't run the checks:", e instanceof Error ? e.message : e);
    await prisma.$disconnect();
    process.exit(2);
  });
