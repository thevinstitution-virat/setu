import { randomInt } from "node:crypto";
import { asPlatform, tenantDb } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { APP_NAME } from "@/lib/brand";
import { publicTenantUrl } from "@/lib/redirect";
import { platformDomain } from "@/lib/tenant";
import {
  EmailAuthError,
  checkEmailCode,
  checkPlatformCode,
  issueEmailCode,
  issuePlatformCode,
  issuePlatformSignInLink,
  issueSignInLink,
  normaliseEmail,
} from "@/lib/email-auth";

/**
 * One-time codes on the MAIN address (no business in the web address). The same emailed code works
 * for every place the address has a login: each business login and the console. After the code is
 * right the browser is handed on to the place's own address (a link the server makes only then, never
 * emailed). Nothing here says whether an address has a login.
 */

export type Place = { label: string; url: string };

type Biz = { id: string; role: string; tenantId: string; tenant: { slug: string; name: string; status: string } };

const businessLogins = (email: string): Promise<Biz[]> =>
  asPlatform((tx) =>
    tx.user.findMany({
      where: { email: { equals: email, mode: "insensitive" }, active: true, isSupport: false, tenant: { status: { not: "CLOSED" } } },
      select: { id: true, role: true, tenantId: true, tenant: { select: { slug: true, name: true, status: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    })
  );

const allowed = (u: Biz) => u.tenant.status !== "SUSPENDED" || u.role === "ADMIN";

/** Makes one code and stores it for every login of this address. True when there is anything to sign in to. */
export async function issueMainCode(emailRaw: string): Promise<string | null> {
  const email = normaliseEmail(emailRaw);
  const [biz, consoleUser] = await Promise.all([businessLogins(email), prisma.platformUser.findUnique({ where: { email }, select: { id: true, active: true } })]);
  const code = String(randomInt(100000, 1000000));
  let any = false;
  for (const u of biz.filter(allowed)) {
    try {
      await issueEmailCode(tenantDb(u.tenantId), u.id, email, "SIGN_IN", Date.now(), code);
      any = true;
    } catch (e) {
      if (!(e instanceof EmailAuthError)) throw e; // too many codes for this login lately: leave it out
    }
  }
  if (consoleUser?.active) {
    try {
      await issuePlatformCode(consoleUser.id, code);
      any = true;
    } catch (e) {
      if (!(e instanceof EmailAuthError)) throw e;
    }
  }
  return any ? code : null;
}

/** Checks the code against every login of this address; returns where each right one leads (links made now). */
export async function checkMainCode(emailRaw: string, codeRaw: string): Promise<Place[]> {
  const email = normaliseEmail(emailRaw);
  const places: Place[] = [];
  const [biz, consoleUser] = await Promise.all([businessLogins(email), prisma.platformUser.findUnique({ where: { email }, select: { id: true, active: true } })]);

  for (const u of biz.filter(allowed)) {
    const db = tenantDb(u.tenantId);
    const c = await checkEmailCode(db, { email, userId: u.id, purpose: "SIGN_IN", code: codeRaw }).catch((e) => {
      if (e instanceof EmailAuthError) return null;
      throw e;
    });
    if (!c) continue;
    // The code proves the address.
    await db.user.updateMany({ where: { id: u.id, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } }).catch(() => {});
    const token = await issueSignInLink(db, u.id, email);
    places.push({ label: u.tenant.name, url: publicTenantUrl(u.tenant.slug, platformDomain(), `/api/auth/email-link?t=${token}`) });
  }

  if (consoleUser?.active && (await checkPlatformCode(consoleUser.id, codeRaw))) {
    const token = await issuePlatformSignInLink(consoleUser.id);
    places.push({ label: `${APP_NAME} console`, url: publicTenantUrl("platform", platformDomain(), `/api/platform/auth/email-link?t=${token}`) });
  }
  return places;
}
