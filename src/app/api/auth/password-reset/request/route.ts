import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { requestIp } from "@/lib/audit";
import { DAY, HOUR, limited } from "@/lib/rate-limit";
import { originOf } from "@/lib/invoice-api";
import { EmailAuthError, issueResetToken, normaliseEmail } from "@/lib/email-auth";
import { EmailError, sendEmail } from "@/lib/email";
import { resetLinkMail } from "@/lib/email-messages";

/**
 * POST { login } — a login id or a verified email address. When it belongs
 * to a password login with a verified address, a reset link goes to that
 * address. The answer is always the same, so nobody learns who has a login.
 */
export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const login = typeof body?.login === "string" ? body.login.trim().slice(0, 254) : "";
  if (!login) return NextResponse.json({ error: "Enter your login id or email address" }, { status: 400 });

  const ip = requestIp(req);
  if ((ip && (await limited("reset-ip", ip, 10, HOUR))) || (await limited(`reset-day:${tenant.id}`, login, 5, DAY))) {
    return NextResponse.json({ error: "Too many reset emails asked for. Please try again later." }, { status: 429 });
  }

  const db = tenantDb(tenant.id);
  const email = normaliseEmail(login);
  const user = await db.user.findFirst({
    where: {
      isSupport: false,
      emailVerifiedAt: { not: null },
      OR: [{ loginId: login }, { email: { equals: email, mode: "insensitive" } }],
    },
    select: { id: true, active: true, email: true, passwordHash: true },
  });
  // Only password logins: shops sign in with codes and have no password to reset.
  if (!user || !user.active || !user.email || !user.passwordHash) return NextResponse.json({ ok: true });

  try {
    const token = await issueResetToken(db, user.id, user.email.toLowerCase());
    const url = `${originOf(req)}/login/reset?t=${encodeURIComponent(token)}`;
    await sendEmail(resetLinkMail(user.email, tenant.name, url));
  } catch (e) {
    if (e instanceof EmailAuthError || e instanceof EmailError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
