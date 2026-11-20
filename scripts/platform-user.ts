/**
 * Add, update or switch off a platform console login (us, not tenants).
 *
 *   npm run platform:user -- --email you@company.in --name "Your name" --password '<strong password>' [--role OWNER|SUPPORT]
 *   npm run platform:user -- --email someone@company.in --deactivate
 *
 * The console lives on the platform address: https://platform.<PLATFORM_DOMAIN>/platform
 * (or the bare domain when PLATFORM_DOMAIN has no tenant subdomain).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function main() {
  const email = (arg("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("--email is required");

  if (flag("deactivate")) {
    const u = await prisma.platformUser.update({ where: { email }, data: { active: false } }).catch(() => null);
    if (!u) fail(`No console login ${email}`);
    console.log(`✔ ${email} can no longer sign in`);
    return;
  }

  const role = (arg("role") ?? "SUPPORT").toUpperCase();
  if (role !== "OWNER" && role !== "SUPPORT") fail("--role must be OWNER or SUPPORT");
  const password = arg("password");
  const name = arg("name");
  const existing = await prisma.platformUser.findUnique({ where: { email } });
  if (!existing && (!password || !name)) fail("A new login needs --name and --password");
  if (password && password.length < 12) fail("--password must be at least 12 characters");

  await prisma.platformUser.upsert({
    where: { email },
    create: { email, name: name!, role, passwordHash: hashPassword(password!) },
    update: { role, active: true, ...(name ? { name } : {}), ...(password ? { passwordHash: hashPassword(password) } : {}) },
  });
  console.log(`✔ ${existing ? "Updated" : "Added"} ${email} (${role})`);
}

main()
  .catch((e) => fail(e instanceof Error ? e.message : String(e)))
  .finally(() => prisma.$disconnect());
