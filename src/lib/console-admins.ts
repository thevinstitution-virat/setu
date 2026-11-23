import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { createTenantRecord, slugProblem } from "@/lib/signup";
import { checkLimit, LimitError } from "@/lib/plans";
import { issueResetToken, normaliseEmail, SET_PASSWORD_TTL_MS, validEmail } from "@/lib/email-auth";
import { sendEmail } from "@/lib/email";
import { setPasswordMail } from "@/lib/email-messages";
import { publicTenantUrl } from "@/lib/redirect";
import { platformDomain } from "@/lib/tenant";
import { validMobile } from "@/lib/field-math";
import { prisma } from "@/lib/prisma";

/**
 * What the platform console's owner (the super-admin) does to a business's
 * admins: make a business with its owner, add admins, send a set-password
 * link, reset two-step sign-in, switch an admin off and hand ownership over.
 * New logins get no password: the person chooses one through a single-use
 * link (3 days) that the console shows, and emails when an address is given.
 */

export class ConsoleAdminError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;

type NewAdmin = {
  name?: unknown;
  loginId?: unknown;
  phone?: unknown;
  email?: unknown;
};

function checkAdmin(a: NewAdmin) {
  const name = typeof a.name === "string" ? a.name.trim().slice(0, 80) : "";
  if (name.length < 2) throw new ConsoleAdminError("Enter the admin's name");
  const loginId = typeof a.loginId === "string" ? a.loginId.trim().toLowerCase() : "";
  if (!LOGIN_RE.test(loginId)) throw new ConsoleAdminError("Login ID: 3 to 40 lower-case letters, numbers, dots, dashes or underscores");
  const phone = typeof a.phone === "string" && a.phone.trim() ? a.phone.replace(/\D/g, "") : null;
  if (phone && !validMobile(phone)) throw new ConsoleAdminError("Enter a 10-digit mobile number");
  const email = typeof a.email === "string" && a.email.trim() ? normaliseEmail(a.email) : null;
  if (email && !validEmail(email)) throw new ConsoleAdminError("Enter a real email address");
  return { name, loginId, phone, email };
}

/** A fresh set-password link for an admin (3 days); emailed when the admin has an address. */
async function passwordLink(tenantId: string, slug: string, bizName: string, userId: string, email: string | null) {
  const token = await issueResetToken(tenantDb(tenantId), userId, email ?? "", Date.now(), SET_PASSWORD_TTL_MS);
  const url = publicTenantUrl(slug, platformDomain(), `/login/reset?t=${token}`);
  let emailed = false;
  if (email)
    emailed = await sendEmail(setPasswordMail(email, bizName, url)).then(
      () => true,
      () => false,
    );
  return { url, emailed };
}

async function openTenant(tenantId: string) {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true, status: true },
  });
  if (!t || t.status === "CLOSED") throw new ConsoleAdminError("Business not found", 404);
  return t;
}

async function adminOf(tenantId: string, userId: string) {
  const u = await tenantDb(tenantId).user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      isSupport: true,
      isOwner: true,
      active: true,
      email: true,
      emailVerifiedAt: true,
      name: true,
    },
  });
  if (!u || u.role !== "ADMIN" || u.isSupport) throw new ConsoleAdminError("Admin not found", 404);
  return u;
}

/** A new business with its owner (no password yet), on a free trial. */
export async function createBusiness(raw: { slug?: unknown; name?: unknown; planCode?: unknown; admin?: NewAdmin }) {
  const slug = typeof raw.slug === "string" ? raw.slug.trim().toLowerCase() : "";
  const problem = await slugProblem(slug);
  if (problem) throw new ConsoleAdminError(`Address: ${problem}`);
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 120) : "";
  if (name.length < 2) throw new ConsoleAdminError("Enter the business name");
  const planCode = typeof raw.planCode === "string" && raw.planCode ? raw.planCode : null;
  if (planCode && !(await prisma.plan.findUnique({ where: { code: planCode } }))) throw new ConsoleAdminError("Unknown plan");
  const admin = checkAdmin(raw.admin ?? {});
  const made = await asPlatform((tx) =>
    createTenantRecord(
      tx,
      { slug, name, phone: admin.phone, planCode },
      {
        name: admin.name,
        loginId: admin.loginId,
        phone: admin.phone,
        email: admin.email,
        // The super-admin vouches for the address: it is how they sign in for now.
        emailConfirmed: !!admin.email,
      },
    ),
  ).catch((e: unknown) => {
    if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") throw new ConsoleAdminError("That address was just taken. Pick another.");
    throw e;
  });
  const link = await passwordLink(made.tenant.id, slug, name, made.user.id, admin.email);
  return {
    tenant: { id: made.tenant.id, slug, name },
    adminId: made.user.id,
    ...link,
  };
}

/** Another admin for a business (counts as a staff seat). */
export async function addAdmin(tenantId: string, raw: NewAdmin) {
  const t = await openTenant(tenantId);
  const a = checkAdmin(raw);
  const user = await withTenantTx(tenantId, async (tx) => {
    if (
      await tx.user.findFirst({
        where: { loginId: a.loginId },
        select: { id: true },
      })
    )
      throw new ConsoleAdminError("That login ID is already in use in this business");
    try {
      await checkLimit(tx, tenantId, "staff");
    } catch (e) {
      if (e instanceof LimitError) throw new ConsoleAdminError(e.message, 402);
      throw e;
    }
    if (a.email && (await tx.user.findFirst({ where: { email: { equals: a.email, mode: "insensitive" } }, select: { id: true } }))) {
      throw new ConsoleAdminError("Another login here already uses that email address");
    }
    return tx.user.create({
      data: {
        name: a.name,
        loginId: a.loginId,
        phone: a.phone,
        email: a.email,
        // The super-admin vouches for the address: it is how they sign in for now.
        emailVerifiedAt: a.email ? new Date() : null,
        role: "ADMIN",
      },
      select: { id: true },
    });
  });
  const link = await passwordLink(tenantId, t.slug, t.name, user.id, a.email);
  return { adminId: user.id, ...link };
}

/** A new set-password link for an admin (lost password, or the first one ran out). */
export async function adminPasswordLink(tenantId: string, userId: string) {
  const t = await openTenant(tenantId);
  const u = await adminOf(tenantId, userId);
  if (!u.active) throw new ConsoleAdminError("Switch this admin on first");
  return passwordLink(tenantId, t.slug, t.name, u.id, u.email);
}

/** Set (or clear) an admin's email as confirmed: the super-admin vouches for it. They sign in with it. */
export async function setAdminEmail(tenantId: string, userId: string, raw: unknown) {
  await openTenant(tenantId);
  await adminOf(tenantId, userId);
  const email = typeof raw === "string" && raw.trim() ? normaliseEmail(raw) : null;
  if (email && !validEmail(email)) throw new ConsoleAdminError("Enter a real email address");
  await withTenantTx(tenantId, async (tx) => {
    if (email && (await tx.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, id: { not: userId } }, select: { id: true } }))) {
      throw new ConsoleAdminError("Another login here already uses that email address");
    }
    await tx.user.update({ where: { id: userId }, data: { email, emailVerifiedAt: email ? new Date() : null } });
  });
}

/** Lost phone: clear the authenticator app and sign them out everywhere. */
export async function resetAdminTwoStep(tenantId: string, userId: string) {
  await openTenant(tenantId);
  await adminOf(tenantId, userId);
  await tenantDb(tenantId).user.update({
    where: { id: userId },
    data: {
      totpSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      recoveryCodes: [],
      sessionVersion: { increment: 1 },
    },
  });
}

/** Switch an admin off or on. The owner can't be switched off: hand ownership to someone else first. */
export async function setAdminActive(tenantId: string, userId: string, active: boolean) {
  await openTenant(tenantId);
  const u = await adminOf(tenantId, userId);
  if (!active && u.isOwner) throw new ConsoleAdminError("The owner can't be switched off. Make another admin the owner first.");
  await withTenantTx(tenantId, async (tx) => {
    if (active && !u.active) {
      try {
        await checkLimit(tx, tenantId, "staff");
      } catch (e) {
        if (e instanceof LimitError) throw new ConsoleAdminError(e.message, 402);
        throw e;
      }
    }
    await tx.user.update({
      where: { id: userId },
      data: { active, ...(active ? {} : { sessionVersion: { increment: 1 } }) },
    });
  });
}

/** Hand the business over to another active admin (the old owner stays an admin). */
export async function makeOwner(tenantId: string, userId: string) {
  await openTenant(tenantId);
  const u = await adminOf(tenantId, userId);
  if (!u.active) throw new ConsoleAdminError("Switch this admin on first");
  if (u.isOwner) return;
  await withTenantTx(tenantId, async (tx) => {
    await tx.user.updateMany({
      where: { isOwner: true },
      data: { isOwner: false },
    });
    await tx.user.update({ where: { id: userId }, data: { isOwner: true } });
  });
}

/** The business's admins for the console (never the hidden support login). */
export async function listAdmins(tenantId: string) {
  const rows = await tenantDb(tenantId).user.findMany({
    where: { role: "ADMIN", isSupport: false },
    select: {
      id: true,
      name: true,
      loginId: true,
      phone: true,
      email: true,
      emailVerifiedAt: true,
      isOwner: true,
      active: true,
      totpEnabledAt: true,
      createdAt: true,
      passwordHash: true,
    },
    orderBy: [{ isOwner: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(({ passwordHash, ...r }) => ({
    ...r,
    hasPassword: !!passwordHash,
  }));
}
