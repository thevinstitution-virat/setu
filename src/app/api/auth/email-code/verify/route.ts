import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { requestIp, audit } from "@/lib/audit";
import { HOUR, limited } from "@/lib/rate-limit";
import { checkEmailCode, EmailAuthError, normaliseEmail } from "@/lib/email-auth";
import { finishSignIn } from "@/lib/mfa";
import { checkMainCode } from "@/lib/main-code";

/**
 * POST { email, code } — checks the emailed code and signs in. The code itself proves the
 * address, so a first sign-in marks it confirmed. Where the browser goes next is decided
 * from the role: the first-sign-in form while it is due, else the person's own dashboard.
 */
export async function POST(req: Request) {
  const tenant = await getTenant();

  const body = await req.json().catch(() => null);
  const email = normaliseEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!email || !code) return NextResponse.json({ error: "Enter the email address and the code" }, { status: 400 });

  // Each code allows 5 tries; this caps guessing across many addresses from one network.
  const ip = requestIp(req);
  if (ip && (await limited("email-check-ip", ip, 60, HOUR))) {
    return NextResponse.json({ error: "Too many tries from this network. Please wait an hour." }, { status: 429 });
  }

  // The main address: the code opens whichever logins it belongs to; the browser is handed on to them.
  if (!tenant) {
    const places = await checkMainCode(email, code);
    if (!places.length) return NextResponse.json({ error: "That code is wrong or has expired" }, { status: 400 });
    return NextResponse.json(places.length === 1 ? { ok: true, redirect: places[0].url } : { ok: true, choose: places });
  }

  const db = tenantDb(tenant.id);
  let challenge;
  try {
    challenge = await checkEmailCode(db, { email, purpose: "SIGN_IN", code });
  } catch (e) {
    if (e instanceof EmailAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  if (!challenge) return NextResponse.json({ error: "That code is wrong or has expired" }, { status: 400 });

  const user = await db.user.findUnique({ where: { id: challenge.userId }, select: { id: true, role: true, active: true, email: true, emailVerifiedAt: true } });
  // The address must still be this login's (the office could have changed it since the code went out).
  if (!user || user.email?.toLowerCase() !== email) return NextResponse.json({ error: "That code is wrong or has expired" }, { status: 400 });
  if (!user.active) return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
  if (tenant.status === "SUSPENDED" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "This business is paused. Please contact the office.", code: "paused" }, { status: 423 });
  }

  if (!user.emailVerifiedAt) {
    try {
      await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    } catch (e) {
      // User_verified_email_once: another login here confirmed this address first.
      if ((e as { code?: string })?.code === "P2002") return NextResponse.json({ error: "That code is wrong or has expired" }, { status: 400 });
      throw e;
    }
  }

  await audit(db, { actorId: user.id, action: "auth.email_code", entity: "User", entityId: user.id, ip });
  const redirect = await finishSignIn(tenant.id, user.id, "email");
  return NextResponse.json({ ok: true, redirect });
}
