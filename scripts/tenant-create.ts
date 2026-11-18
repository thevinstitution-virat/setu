/**
 * Create a new tenant (distributor) with its first admin.
 *
 *   npm run tenant:create -- --slug agarwal --name "Agarwal Enterprises" \
 *     --admin-login owner --admin-password '<strong password>' [--admin-name "Owner"] [--state 27] [--gstin ...]
 *
 * The tenant is then live at https://<slug>.<PLATFORM_DOMAIN>.
 * (A web console for this comes in Phase 9; this is the safe first step.)
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";

const RESERVED = new Set(["www", "app", "api", "admin", "platform", "static", "cdn", "mail", "demo", "second"]);

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

  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(slug)) fail("--slug: 3–30 letters, digits or dashes");
  if (RESERVED.has(slug)) fail(`--slug "${slug}" is reserved`);
  if (!name) fail("--name is required");
  if (!adminLogin) fail("--admin-login is required");
  if (!adminPassword || adminPassword.length < 10) fail("--admin-password must be at least 10 characters");

  const prisma = new PrismaClient();
  try {
    if (await prisma.tenant.findUnique({ where: { slug } })) fail(`A tenant "${slug}" already exists`);

    const tenant = await prisma.tenant.create({
      data: { slug, name, stateCode: arg("state"), gstin: arg("gstin"), status: "TRIAL" },
    });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.id}, TRUE)`;
      await tx.user.create({
        data: { name: adminName, loginId: adminLogin, passwordHash: hashPassword(adminPassword), role: "ADMIN" },
      });
    });

    const domain = process.env.PLATFORM_DOMAIN ?? "localhost";
    const port = domain === "localhost" ? ":3100" : "";
    const scheme = domain === "localhost" ? "http" : "https";
    console.log(`✔ Tenant "${name}" created`);
    console.log(`  URL:   ${scheme}://${slug}.${domain}${port}`);
    console.log(`  Admin: ${adminLogin}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
