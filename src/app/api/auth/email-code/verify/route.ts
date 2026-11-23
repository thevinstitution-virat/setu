import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { HOUR, limited } from "@/lib/rate-limit";
import { checkEmailCode, EmailAuthError, normaliseEmail } from "@/lib/email-auth";
import { finishSignIn } from "@/lib/mfa";

/** POST { email, code } — step one of signing in with an emailed code (staff then do step two). */
export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const email = normaliseEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code : "";
  if (!email || !code) return NextResponse.json({ error: "Enter the email address and the code" }, { status: 400 });

  // Each code allows 5 tries; this caps guessing across many addresses from one network.
  const ip = requestIp(req);
  if (ip && (await limited("email-check-ip", ip, 60, HOUR))) {
    return NextResponse.json({ error: "Too many tries from this network. Please wait an hour." }, { status: 429 });
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
  // The address must still be this login's verified one (it could have been removed since the code went out).
  if (!user || !user.emailVerifiedAt || user.email?.toLowerCase() !== email) return NextResponse.json({ error: "That code is wrong or has expired" }, { status: 400 });
  if (!user.active) return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
  if (tenant.status === "SUSPENDED" && user.role !== "ADMIN") {
    return NextResponse.json({ error: "This business is paused. Please contact the office.", code: "paused" }, { status: 423 });
  }

  const redirect = await finishSignIn(tenant.id, user.id, "email");
  return NextResponse.json({ ok: true, redirect });
}
