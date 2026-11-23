import { asPlatform, tenantDb } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { EmailAuthError, issuePlatformSignInLink, issueSignInLink, normaliseEmail } from "@/lib/email-auth";
import { renderMail, sendEmail, type Mail } from "@/lib/email";
import { publicTenantUrl } from "@/lib/redirect";
import { platformDomain } from "@/lib/tenant";
import { APP_NAME } from "@/lib/brand";

/**
 * "Email me a sign-in link" on the main address and the console: one email
 * with a one-click link (15 minutes, once) for every place this address may
 * sign in. Business logins count only with a confirmed address (and in a
 * paused business only admins); the console login is its own email. Staff and
 * the console still give their authenticator code after the link.
 */

export type SignInPlace = { label: string; url: string };

/** The business logins this address may sign in to, each with a fresh link. */
export async function businessLinks(emailRaw: string): Promise<SignInPlace[]> {
  const email = normaliseEmail(emailRaw);
  const users = await asPlatform((tx) =>
    tx.user.findMany({
      where: { email: { equals: email, mode: "insensitive" }, emailVerifiedAt: { not: null }, active: true, isSupport: false },
      select: { id: true, role: true, tenantId: true, tenant: { select: { slug: true, name: true, status: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    })
  );
  const places: SignInPlace[] = [];
  for (const u of users) {
    if (u.tenant.status === "CLOSED") continue;
    if (u.tenant.status === "SUSPENDED" && u.role !== "ADMIN") continue;
    try {
      const token = await issueSignInLink(tenantDb(u.tenantId), u.id, email);
      places.push({ label: `Sign in to ${u.tenant.name}`, url: publicTenantUrl(u.tenant.slug, platformDomain(), `/api/auth/email-link?t=${token}`) });
    } catch (e) {
      if (!(e instanceof EmailAuthError)) throw e; // too many links for this login lately: leave it out
    }
  }
  return places;
}

/** The console login with this address, with a fresh link, or null. */
export async function consoleLink(emailRaw: string): Promise<SignInPlace | null> {
  const u = await prisma.platformUser.findUnique({ where: { email: normaliseEmail(emailRaw) }, select: { id: true, active: true } });
  if (!u?.active) return null;
  try {
    const token = await issuePlatformSignInLink(u.id);
    return { label: `Sign in to the ${APP_NAME} console`, url: publicTenantUrl("platform", platformDomain(), `/api/platform/auth/email-link?t=${token}`) };
  } catch (e) {
    if (e instanceof EmailAuthError) return null;
    throw e;
  }
}

export function signInLinksMail(to: string, places: SignInPlace[]): Mail {
  return {
    to,
    subject: `Your ${APP_NAME} sign-in link${places.length > 1 ? "s" : ""}`,
    ...renderMail({
      brand: APP_NAME,
      title: places.length > 1 ? "Choose where to sign in" : "Your sign-in link",
      lines: ["Each link works once, for 15 minutes. Staff and console logins then ask for the code from your authenticator app."],
      links: places,
      footer: "If you didn't ask for this, ignore this email. Nobody can sign in without the link.",
    }),
  };
}

/** Finds the places, sends one email when there are any; says nothing about whether there were. */
export async function sendSignInLinks(emailRaw: string, opts: { business: boolean; console: boolean }) {
  const email = normaliseEmail(emailRaw);
  const places = [...(opts.console ? [await consoleLink(email)].filter((p): p is SignInPlace => !!p) : []), ...(opts.business ? await businessLinks(email) : [])];
  if (places.length) await sendEmail(signInLinksMail(email, places));
  return places.length;
}
