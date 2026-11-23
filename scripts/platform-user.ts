/**
 * Add, update or switch off a platform console login (us, not tenants).
 *
 *   npm run platform:user -- --email you@company.in --name "Your name" --password '<strong password>' [--role OWNER|SUPPORT]
 *   npm run platform:user -- --email someone@company.in --deactivate
 *   npm run platform:user -- --email someone@company.in --reset-2fa   (lost phone: set the authenticator up again at next sign-in)
 *   npm run platform:user -- --email old@company.in --new-email new@company.in   (move a login to another address; signs it out)
 *
 * OWNER is the super-admin: there is only ever one (a database index enforces it). To hand it to
 * someone else, move the existing OWNER login to their address with --new-email.
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

  if (flag("reset-2fa")) {
    const u = await prisma.platformUser
      .update({ where: { email }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } })
      .catch(() => null);
    if (!u) fail(`No console login ${email}`);
    await prisma.platformAudit.create({ data: { actorId: u.id, action: "auth.mfa_reset_by_script" } });
    console.log(`✔ Two-step sign-in reset for ${email}: they set up the authenticator app at their next sign-in`);
    return;
  }

  const newEmail = (arg("new-email") ?? "").trim().toLowerCase();
  if (newEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) fail("--new-email is not an email address");
    if (await prisma.platformUser.findUnique({ where: { email: newEmail } })) fail(`${newEmail} already has a console login`);
    const u = await prisma.platformUser
      .update({ where: { email }, data: { email: newEmail, sessionVersion: { increment: 1 } } })
      .catch(() => null);
    if (!u) fail(`No console login ${email}`);
    await prisma.platformAudit.create({ data: { actorId: u.id, action: "auth.email_moved_by_script", detail: { from: email, to: newEmail } } });
    console.log(`✔ ${email} is now ${newEmail} (${u.role}); signed out everywhere`);
    return;
  }

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
  if (role === "OWNER") {
    const owner = await prisma.platformUser.findFirst({ where: { role: "OWNER" }, select: { email: true } });
    if (owner && owner.email !== email) fail(`There is already a super-admin (${owner.email}). Move it with --email ${owner.email} --new-email ${email}`);
  }
  if (existing?.role === "OWNER" && role !== "OWNER") fail("This is the super-admin; it can't be turned into a support login");
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
