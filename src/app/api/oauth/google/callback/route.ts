import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { localRedirect } from "@/lib/redirect";
import { requestIp } from "@/lib/audit";
import { noticeCode } from "@/lib/login-notices";
import { getPlatformSession, platformAudit } from "@/lib/platform-auth";
import { setPlatformPending } from "@/lib/platform-mfa";
import { checkNonceCookie, checkReturnHost, exchangeCode, GoogleError, hostUrl, readState, signTicket, type GoogleIdentity, type GoogleState } from "@/lib/google";

/**
 * The one address Google returns to (register it on the OAuth client):
 * https://<PLATFORM_DOMAIN>/api/oauth/google/callback. Console sign-ins
 * finish here; business ones go back to their own address with a ticket.
 */
export async function GET(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = new URL(req.url);
  let state: GoogleState | null = null;
  try {
    state = await readState(url.searchParams.get("state"));
    // A business round trip returns to an address checked against that business before anything else.
    const host = state.k === "tenant" ? await checkReturnHost(state) : null;
    if (url.searchParams.get("error")) throw new GoogleError("Google didn't confirm the sign-in. Please try again.");
    if (state.k === "console") await checkNonceCookie(state.n);
    const who = await exchangeCode(url.searchParams.get("code") ?? "", state.n);
    if (host) return NextResponse.redirect(await signTicket(state, who, host), 303);
    return await finishConsole(state, who, requestIp(req));
  } catch (e) {
    if (!(e instanceof GoogleError)) throw e;
    const code = noticeCode(e.message, "google");
    if (state?.k === "tenant" && state.host) {
      const host = await checkReturnHost(state).catch(() => null);
      if (host) return NextResponse.redirect(hostUrl(host, `/login?notice=${code}`), 303);
    }
    return localRedirect(`/platform/login?notice=${code}`, 303);
  }
}

async function finishConsole(state: GoogleState, who: GoogleIdentity, ip: string | null) {
  if (state.intent === "link") {
    const s = await getPlatformSession();
    if (!s || s.platformUserId !== state.uid) return localRedirect("/platform/login?notice=google-expired", 303);
    try {
      await prisma.platformUser.update({ where: { id: s.platformUserId }, data: { googleSub: who.sub, googleEmail: who.email } });
    } catch {
      return localRedirect("/platform/security?notice=google-taken", 303);
    }
    await platformAudit(s.platformUserId, "auth.google_linked", { detail: { googleEmail: who.email }, ip });
    return localRedirect("/platform/security?notice=google-linked", 303);
  }
  let u = await prisma.platformUser.findUnique({ where: { googleSub: who.sub } });
  if (!u) {
    const byEmail = await prisma.platformUser.findFirst({ where: { email: who.email, googleSub: null } });
    if (byEmail) u = await prisma.platformUser.update({ where: { id: byEmail.id }, data: { googleSub: who.sub, googleEmail: who.email } });
  }
  if (!u || !u.active) {
    await platformAudit(u?.id ?? null, "auth.google_failed", { detail: { googleEmail: who.email }, ip });
    return localRedirect("/platform/login?notice=google-none", 303);
  }
  await setPlatformPending({ platformUserId: u.id, via: "google" });
  await platformAudit(u.id, "auth.google_ok", { ip });
  return localRedirect("/platform/login/2fa", 303);
}
