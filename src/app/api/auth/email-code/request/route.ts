import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { DAY, HOUR, limited } from "@/lib/rate-limit";
import { EmailAuthError, issueEmailCode, normaliseEmail, userByEmail, validEmail } from "@/lib/email-auth";
import { EmailError, emailDevMode, sendEmail } from "@/lib/email";
import { signInCodeMail } from "@/lib/email-messages";
import { issueMainCode } from "@/lib/main-code";
import { APP_NAME } from "@/lib/brand";

/** "rajesh.kumar99@x.com" → "Rajesh Kumar": a placeholder name until the first-sign-in form. */
const nameFromEmail = (email: string) =>
  email
    .split("@")[0]
    .replace(/[0-9_.+-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
    .slice(0, 60) || "New shop";

/**
 * POST { email } — emails a one-time sign-in code. The one sign-in for everyone:
 * an address the business knows (staff the admin gave a role, shops) gets a code for
 * its login; an address nobody has used yet becomes a new SHOPKEEPER login, filled in
 * at the first sign-in. The answer is the same either way, so the form can't be used
 * to find out who has a login.
 */
export async function POST(req: Request) {
  const tenant = await getTenant();
  const body = await req.json().catch(() => null);
  const email = normaliseEmail(body?.email);
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  const ip = requestIp(req);

  // The main address (no business in the web address): one code for every login this address has.
  if (!tenant) {
    if ((ip && (await limited("email-code-ip", ip, 20, HOUR))) || (await limited("email-code-day:main", email, 10, DAY))) {
      return NextResponse.json({ error: "Too many codes asked for. Please try again later." }, { status: 429 });
    }
    try {
      const code = await issueMainCode(email);
      if (code) await sendEmail(signInCodeMail(email, APP_NAME, code));
      return NextResponse.json({ ok: true, ...(code && emailDevMode() ? { devCode: code } : {}) });
    } catch (e) {
      if (e instanceof EmailAuthError || e instanceof EmailError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  }

  if ((ip && (await limited("email-code-ip", ip, 20, HOUR))) || (await limited(`email-code-day:${tenant.id}`, email, 10, DAY))) {
    return NextResponse.json({ error: "Too many codes asked for. Please try again later." }, { status: 429 });
  }

  const db = tenantDb(tenant.id);
  let user = await userByEmail(db, email);
  if (!user) {
    // A paused business takes no new shops.
    if (tenant.status === "SUSPENDED") return NextResponse.json({ ok: true });
    try {
      user = await db.user.create({
        data: { name: nameFromEmail(email), email, role: "RETAILER", onboardingDue: true },
        select: { id: true, name: true, role: true, active: true, loginId: true, email: true, emailVerifiedAt: true },
      });
    } catch {
      // Two first requests at once: the other one made it.
      user = await userByEmail(db, email);
    }
  }
  // A paused business: only the owner's side can still sign in.
  const allowed = !!user && user.active && (tenant.status !== "SUSPENDED" || user.role === "ADMIN");
  if (!allowed || !user) return NextResponse.json({ ok: true });

  try {
    const code = await issueEmailCode(db, user.id, email, "SIGN_IN");
    await sendEmail(signInCodeMail(email, tenant.name, code));
    // Development without a key only: the code on screen.
    return NextResponse.json({ ok: true, ...(emailDevMode() ? { devCode: code } : {}) });
  } catch (e) {
    if (e instanceof EmailAuthError || e instanceof EmailError) return NextResponse.json({ error: e.message, ...(e instanceof EmailAuthError ? {} : {}) }, { status: e.status });
    throw e;
  }
}
