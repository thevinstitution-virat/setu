import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { DAY, HOUR, limited } from "@/lib/rate-limit";
import { EmailAuthError, issueEmailCode, normaliseEmail, userByVerifiedEmail, validEmail } from "@/lib/email-auth";
import { EmailError, emailDevMode, sendEmail } from "@/lib/email";
import { signInCodeMail } from "@/lib/email-messages";

/**
 * POST { email } — emails a sign-in code to a login's verified address.
 * The answer is the same whether or not the address belongs to anyone here,
 * so the form can't be used to find out who has a login.
 */
export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const email = normaliseEmail(body?.email);
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });

  const ip = requestIp(req);
  if ((ip && (await limited("email-code-ip", ip, 20, HOUR))) || (await limited(`email-code-day:${tenant.id}`, email, 10, DAY))) {
    return NextResponse.json({ error: "Too many codes asked for. Please try again later." }, { status: 429 });
  }

  const db = tenantDb(tenant.id);
  const user = await userByVerifiedEmail(db, email);
  // A paused business: only the owner can still sign in (as with passwords).
  const allowed = !!user && user.active && (tenant.status !== "SUSPENDED" || user.role === "ADMIN");
  if (!allowed) return NextResponse.json({ ok: true });

  try {
    const code = await issueEmailCode(db, user.id, email, "SIGN_IN");
    await sendEmail(signInCodeMail(email, tenant.name, code));
    // Development without a key only: the code on screen, as with phone codes.
    return NextResponse.json({ ok: true, ...(emailDevMode() ? { devCode: code } : {}) });
  } catch (e) {
    if (e instanceof EmailAuthError || e instanceof EmailError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
