/**
 * "Email me a sign-in link" (lib/email-links.ts, lib/email-auth.ts): links
 * used once that can't stand in for a reset link, one per business where the
 * address is confirmed (never a paused business for non-admins or a closed
 * one), the console's own link, and the confirmed emails the super-admin and
 * admins set (lib/console-admins.ts, lib/staff.ts).
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { purgeTenant } from "@/lib/tenant-data";
import { renderMail } from "@/lib/email";
import { issueSignInLink, readResetToken, readSignInLink, spendSignInLink, issuePlatformSignInLink, readPlatformSignInLink, spendPlatformSignInLink, readPlatformResetToken } from "@/lib/email-auth";
import { businessLinks, consoleLink, signInLinksMail } from "@/lib/email-links";
import { addAdmin, createBusiness, setAdminEmail } from "@/lib/console-admins";
import { checkStaffFields } from "@/lib/staff";

const rand = () => Math.random().toString(36).slice(2, 8);
const made: string[] = [];
const consoleUsers: string[] = [];

afterAll(async () => {
  for (const id of made) await purgeTenant(id).catch(() => null);
  if (consoleUsers.length) await prisma.platformUser.deleteMany({ where: { id: { in: consoleUsers } } });
  await prisma.$disconnect();
});

const business = async (adminEmail?: string) => {
  const r = await createBusiness({ slug: `lnk${rand()}`, name: `Link test ${rand()}`, admin: { name: "Link Owner", loginId: "owner", email: adminEmail } });
  made.push(r.tenant.id);
  return r;
};

describe("sign-in links in a business", () => {
  it("work once, expire after 15 minutes, and are not reset links", async () => {
    const email = `l-${rand()}@example.com`;
    const r = await business(email);
    const db = tenantDb(r.tenant.id);
    const token = await issueSignInLink(db, r.adminId, email);
    expect(await readResetToken(db, token)).toBeNull();
    const c = await readSignInLink(db, token);
    expect(c?.userId).toBe(r.adminId);
    expect(await spendSignInLink(db, c!.id, r.adminId)).toBe(true);
    expect(await spendSignInLink(db, c!.id, r.adminId)).toBe(false);
    expect(await readSignInLink(db, token)).toBeNull();
    expect(await readSignInLink(db, await issueSignInLink(db, r.adminId, email, Date.now() - 16 * 60_000))).toBeNull();
  });

  it("go to every business where the address is confirmed, never paused (except admins) or closed ones", async () => {
    const email = `many-${rand()}@example.com`;
    const a = await business(email);
    const b = await business(email);
    const c = await business(email);
    const d = await business();
    // In d the address is only typed in, not confirmed.
    await tenantDb(d.tenant.id).user.create({ data: { name: "Typed", role: "SALES_AGENT", loginId: "typed", email } });
    expect((await businessLinks(email.toUpperCase())).length).toBe(3);

    await prisma.tenant.update({ where: { id: b.tenant.id }, data: { status: "CLOSED" } });
    await prisma.tenant.update({ where: { id: c.tenant.id }, data: { status: "SUSPENDED" } });
    const links = await businessLinks(email);
    expect(links.map((l) => l.label)).toEqual([`Sign in to ${a.tenant.name}`, `Sign in to ${c.tenant.name}`]);
    expect(links[0].url).toContain(`${a.tenant.slug}.`);
    expect(links[0].url).toContain("/api/auth/email-link?t=");

    // A paused business lets only its admins in: a sales agent there gets no link.
    const agentEmail = `agent-${rand()}@example.com`;
    await tenantDb(c.tenant.id).user.create({ data: { name: "Agent", role: "SALES_AGENT", loginId: "agent", email: agentEmail, emailVerifiedAt: new Date() } });
    expect(await businessLinks(agentEmail)).toEqual([]);
    expect(await businessLinks(`nobody-${rand()}@example.com`)).toEqual([]);
  });
});

describe("the console's link", () => {
  it("is its own, used once, and never a reset link", async () => {
    const email = `console-${rand()}@example.com`;
    const u = await prisma.platformUser.create({ data: { email, name: "Console link test", passwordHash: "x" } });
    consoleUsers.push(u.id);
    const place = await consoleLink(email.toUpperCase());
    expect(place?.url).toContain("platform.");
    expect(place?.url).toContain("/api/platform/auth/email-link?t=");

    const token = await issuePlatformSignInLink(u.id);
    expect(await readPlatformResetToken(token)).toBeNull();
    const r = await readPlatformSignInLink(token);
    expect(r?.platformUserId).toBe(u.id);
    expect(await spendPlatformSignInLink(r!.id, u.id)).toBe(true);
    expect(await readPlatformSignInLink(token)).toBeNull();

    await prisma.platformUser.update({ where: { id: u.id }, data: { active: false } });
    expect(await consoleLink(email)).toBeNull();
  });

  it("puts every place in one email as buttons and plain links", () => {
    const mail = signInLinksMail("a@example.com", [
      { label: "Sign in to A", url: "https://a.x.test/l?t=1" },
      { label: "Sign in to B", url: "https://b.x.test/l?t=2" },
    ]);
    expect(mail.subject).toContain("links");
    expect(mail.text).toContain("Sign in to A: https://a.x.test/l?t=1");
    expect(mail.text).toContain("Sign in to B: https://b.x.test/l?t=2");
    expect(mail.html).toContain("https://b.x.test/l?t=2");
    const one = renderMail({ brand: "X", title: "T", lines: [], links: [{ label: "Go", url: "https://g.test/?a=1&b=2" }] });
    expect(one.html).toContain("https://g.test/?a=1&amp;b=2");
  });
});

describe("confirmed emails set by the super-admin and admins", () => {
  it("count as confirmed, refuse a clash and can be cleared", async () => {
    const email = `set-${rand()}@example.com`;
    const r = await business();
    const T = r.tenant.id;
    const other = await addAdmin(T, { name: "Other Admin", loginId: "other", email: `o-${email}` });
    expect((await tenantDb(T).user.findUniqueOrThrow({ where: { id: other.adminId } })).emailVerifiedAt).not.toBeNull();

    await setAdminEmail(T, r.adminId, email.toUpperCase());
    const owner = await tenantDb(T).user.findUniqueOrThrow({ where: { id: r.adminId } });
    expect(owner.email).toBe(email);
    expect(owner.emailVerifiedAt).not.toBeNull();
    expect((await businessLinks(email)).length).toBe(1);
    await expect(setAdminEmail(T, other.adminId, email)).rejects.toThrow(/already uses/);
    await expect(setAdminEmail(T, other.adminId, "not-an-email")).rejects.toThrow(/real email/);

    // The Team page: the same address on a second login is refused; a new one is confirmed at once.
    const clash = await checkStaffFields(tenantDb(T), null, { email: email.toUpperCase() });
    expect("error" in clash && clash.error).toMatch(/already uses/);
    const ok = await checkStaffFields(tenantDb(T), null, { email: `agent-${email}` });
    expect("data" in ok && ok.data.emailVerifiedAt).toBeInstanceOf(Date);
    const mine = await checkStaffFields(tenantDb(T), r.adminId, { email });
    expect("data" in mine).toBe(true);

    await setAdminEmail(T, r.adminId, "");
    const cleared = await tenantDb(T).user.findUniqueOrThrow({ where: { id: r.adminId } });
    expect(cleared.email).toBeNull();
    expect(cleared.emailVerifiedAt).toBeNull();
  });
});
