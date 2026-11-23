/**
 * Business owner, extra admins and the super-admin (lib/team-rules.ts,
 * lib/console-admins.ts): who may change whom, one owner per business, one
 * super-admin on the platform, and the console's add / link / hand-over.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { purgeTenant } from "@/lib/tenant-data";
import { addProblem, changeProblem, type TeamActor, type TeamTarget } from "@/lib/team-rules";
import { addAdmin, adminPasswordLink, ConsoleAdminError, createBusiness, listAdmins, makeOwner, setAdminActive } from "@/lib/console-admins";
import { readResetToken } from "@/lib/email-auth";

const rand = () => Math.random().toString(36).slice(2, 8);

describe("who may change whom", () => {
  const owner: TeamActor = { userId: "o", isOwner: true, isSupport: false };
  const admin: TeamActor = { userId: "a", isOwner: false, isSupport: false };
  const support: TeamActor = { userId: "s", isOwner: false, isSupport: true };
  const ownerRow: TeamTarget = { id: "o", role: "ADMIN", isOwner: true, isSupport: false };
  const adminRow: TeamTarget = { id: "a", role: "ADMIN", isOwner: false, isSupport: false };
  const admin2: TeamTarget = { id: "a2", role: "ADMIN", isOwner: false, isSupport: false };
  const agent: TeamTarget = { id: "g", role: "SALES_AGENT", isOwner: false, isSupport: false };
  const supportRow: TeamTarget = { id: "s", role: "ADMIN", isOwner: false, isSupport: true };

  it("lets only the owner (or support) add admins; anyone adds field staff", () => {
    expect(addProblem(owner, "ADMIN")).toBeNull();
    expect(addProblem(support, "ADMIN")).toBeNull();
    expect(addProblem(admin, "ADMIN")).toMatch(/owner/);
    expect(addProblem(admin, "SALES_AGENT")).toBeNull();
  });

  it("keeps the owner's login out of everyone else's reach, support included", () => {
    for (const a of ["edit", "deactivate", "password", "resetMfa", "signOut"] as const) {
      expect(changeProblem(admin, ownerRow, a)).not.toBeNull();
      expect(changeProblem(support, ownerRow, a)).not.toBeNull();
    }
    expect(changeProblem(owner, ownerRow, "edit")).toBeNull();
    expect(changeProblem(owner, ownerRow, "deactivate")).toMatch(/yourself/);
    expect(changeProblem(owner, ownerRow, "password")).toMatch(/security/i);
  });

  it("lets only the owner (or support) change other admins; admins manage field staff and themselves", () => {
    expect(changeProblem(admin, admin2, "deactivate")).toMatch(/owner/);
    expect(changeProblem(admin, admin2, "password")).toMatch(/owner/);
    expect(changeProblem(owner, adminRow, "deactivate")).toBeNull();
    expect(changeProblem(owner, adminRow, "password")).toBeNull();
    expect(changeProblem(support, adminRow, "resetMfa")).toBeNull();
    expect(changeProblem(admin, adminRow, "password")).toBeNull();
    expect(changeProblem(admin, adminRow, "deactivate")).toMatch(/yourself/);
    for (const a of ["edit", "deactivate", "password", "resetMfa", "signOut"] as const) expect(changeProblem(admin, agent, a)).toBeNull();
  });

  it("never touches the hidden support login", () => {
    expect(changeProblem(owner, supportRow, "deactivate")).toMatch(/support/);
  });
});

describe("console: businesses and their admins", () => {
  const made: string[] = [];
  afterAll(async () => {
    for (const id of made) await purgeTenant(id).catch(() => null);
  });

  it("makes a business whose first admin is the owner, with a set-password link and no password", async () => {
    const slug = `own${rand()}`;
    const r = await createBusiness({ slug, name: "Owner test", admin: { name: "Ravi Owner", loginId: "ravi", phone: "9811100001" } });
    made.push(r.tenant.id);
    expect(r.url).toContain(`/login/reset?t=`);
    const token = new URL(r.url).searchParams.get("t");
    const db = tenantDb(r.tenant.id);
    const c = await readResetToken(db, token);
    expect(c?.userId).toBe(r.adminId);
    expect(c!.expiresAt.getTime() - Date.now()).toBeGreaterThan(71 * 3_600_000);
    const admins = await listAdmins(r.tenant.id);
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({ isOwner: true, hasPassword: false, loginId: "ravi" });
    await expect(createBusiness({ slug, name: "Again", admin: { name: "X Y", loginId: "xy1" } })).rejects.toBeInstanceOf(ConsoleAdminError);
  });

  it("adds admins, keeps one owner, hands ownership over and never switches the owner off", async () => {
    const r = await createBusiness({ slug: `own${rand()}`, name: "Owner test 2", admin: { name: "First Owner", loginId: "first" } });
    made.push(r.tenant.id);
    const T = r.tenant.id;
    const second = await addAdmin(T, { name: "Second Admin", loginId: "second" });
    await expect(addAdmin(T, { name: "Dup", loginId: "second" })).rejects.toThrow(/already in use/);
    await expect(setAdminActive(T, r.adminId, false)).rejects.toThrow(/owner can't be switched off/);

    // A second owner is refused by the database itself.
    await expect(tenantDb(T).user.update({ where: { id: second.adminId }, data: { isOwner: true } })).rejects.toMatchObject({ code: "P2002" });

    await makeOwner(T, second.adminId);
    const after = await listAdmins(T);
    expect(after.filter((a) => a.isOwner).map((a) => a.id)).toEqual([second.adminId]);
    await setAdminActive(T, r.adminId, false);
    await expect(adminPasswordLink(T, r.adminId)).rejects.toThrow(/Switch this admin on/);
    const link = await adminPasswordLink(T, second.adminId);
    expect(link.url).toContain("/login/reset?t=");
  });

  it("allows only one super-admin on the platform", async () => {
    const owners = await prisma.platformUser.count({ where: { role: "OWNER" } });
    const email = `owner-${rand()}@example.com`;
    if (owners === 0) {
      const a = await prisma.platformUser.create({ data: { email, name: "A", passwordHash: "x", role: "OWNER" } });
      await expect(prisma.platformUser.create({ data: { email: `b-${email}`, name: "B", passwordHash: "x", role: "OWNER" } })).rejects.toMatchObject({ code: "P2002" });
      await prisma.platformUser.delete({ where: { id: a.id } });
    } else {
      await expect(prisma.platformUser.create({ data: { email, name: "B", passwordHash: "x", role: "OWNER" } })).rejects.toMatchObject({ code: "P2002" });
    }
  });
});
