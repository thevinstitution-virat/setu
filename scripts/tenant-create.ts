/**
 * Create a new tenant (distributor) with its first admin and a free trial.
 *
 *   npm run tenant:create -- --slug agarwal --name "Agarwal Enterprises" \
 *     --admin-login owner --admin-password '<strong password>' [--admin-name "Owner"] [--state 27] [--gstin ...] [--plan growth]
 *
 * The tenant is then live at https://<slug>.<PLATFORM_DOMAIN>. Businesses
 * normally sign up themselves at /start on the platform address (Phase 9);
 * this is for the platform team.
 */
import "dotenv/config";
import { asPlatform } from "../src/lib/db";
import { createTenantRecord, slugProblem } from "../src/lib/signup";
import { prisma } from "../src/lib/prisma";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function main() {
  const slug = (arg("slug") ?? "").toLowerCase();
  const name = arg("name");
  const adminLogin = arg("admin-login");
  const adminPassword = arg("admin-password");
  const adminName = arg("admin-name") ?? "Owner";
  const planCode = arg("plan") ?? null;

  const problem = await slugProblem(slug);
  if (problem) fail(`--slug: ${problem}`);
  if (!name) fail("--name is required");
  if (!adminLogin) fail("--admin-login is required");
  if (!adminPassword || adminPassword.length < 10) fail("--admin-password must be at least 10 characters");
  if (planCode && !(await prisma.plan.findUnique({ where: { code: planCode } }))) fail(`--plan "${planCode}" does not exist`);

  const { tenant } = await asPlatform((tx) =>
    createTenantRecord(tx, { slug, name, stateCode: arg("state") ?? null, gstin: arg("gstin") ?? null, planCode }, { name: adminName, loginId: adminLogin, password: adminPassword })
  );

  const domain = process.env.PLATFORM_DOMAIN ?? "localhost";
  const port = domain === "localhost" ? ":3100" : "";
  const scheme = domain === "localhost" ? "http" : "https";
  console.log(`✔ Tenant "${tenant.name}" created (free trial${planCode ? `, then ${planCode}` : ""})`);
  console.log(`  URL:   ${scheme}://${slug}.${domain}${port}`);
  console.log(`  Admin: ${adminLogin}`);
}

main()
  .catch((e) => fail(e instanceof Error ? e.message : String(e)))
  .finally(() => prisma.$disconnect());
