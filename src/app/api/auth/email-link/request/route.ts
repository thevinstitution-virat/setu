import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { requestIp } from "@/lib/audit";
import { DAY, HOUR, limited } from "@/lib/rate-limit";
import { normaliseEmail, validEmail } from "@/lib/email-auth";
import { EmailError } from "@/lib/email";
import { sendSignInLinks } from "@/lib/email-links";

/**
 * POST { email } on the main address or the console address: emails one-click
 * sign-in links for every business login that confirmed this address, and the
 * console login if it is one. Always the same answer, so it can't be used to
 * find out who has a login.
 */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Use the email code form on this business's address" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const email = normaliseEmail(body?.email);
  if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });

  const ip = requestIp(req);
  if ((ip && (await limited("email-link-ip", ip, 20, HOUR))) || (await limited("email-link-day", email, 10, DAY))) {
    return NextResponse.json({ error: "Too many links asked for. Please try again later." }, { status: 429 });
  }
  try {
    await sendSignInLinks(email, { business: true, console: true });
  } catch (e) {
    if (e instanceof EmailError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ ok: true });
}
