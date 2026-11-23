import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenant } from "@/lib/tenant";
import { requestIp } from "@/lib/audit";
import { DAY, HOUR, limited } from "@/lib/rate-limit";
import { originOf } from "@/lib/invoice-api";
import { APP_NAME } from "@/lib/brand";
import { EmailAuthError, issuePlatformResetToken, normaliseEmail, validEmail } from "@/lib/email-auth";
import { EmailError, sendEmail } from "@/lib/email";
import { resetLinkMail } from "@/lib/email-messages";

/** POST { email } — a console password-reset link to that address. Same answer either way. */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const email = normaliseEmail(body?.email);
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });

  const ip = requestIp(req);
  if ((ip && (await limited("platform-reset-ip", ip, 10, HOUR))) || (await limited("platform-reset-day", email, 5, DAY))) {
    return NextResponse.json({ error: "Too many reset emails asked for. Please try again later." }, { status: 429 });
  }

  const u = await prisma.platformUser.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true, email: true, active: true } });
  if (!u || !u.active) return NextResponse.json({ ok: true });

  try {
    const token = await issuePlatformResetToken(u.id);
    await sendEmail(resetLinkMail(u.email, `${APP_NAME} console`, `${originOf(req)}/platform/login/reset?t=${encodeURIComponent(token)}`));
  } catch (e) {
    if (e instanceof EmailAuthError || e instanceof EmailError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
