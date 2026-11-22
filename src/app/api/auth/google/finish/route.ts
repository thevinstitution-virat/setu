import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { localRedirect } from "@/lib/redirect";
import { pageSession } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { noticeCode } from "@/lib/login-notices";
import { finishSignIn } from "@/lib/mfa";
import { GoogleError, redeemTicket } from "@/lib/google";

/** ?t=<ticket> on the business address, back from Google (lib/google.ts). */
export async function GET(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return localRedirect("/");
  const db = tenantDb(tenant.id);
  let ticket;
  try {
    ticket = await redeemTicket(new URL(req.url).searchParams.get("t") ?? "", tenant.id);
  } catch (e) {
    if (e instanceof GoogleError) return localRedirect(`/login?notice=${noticeCode(e.message, "google")}`, 303);
    throw e;
  }
  const ip = requestIp(req);

  if (ticket.intent === "link") {
    const s = await pageSession();
    if (!s || s.userId !== ticket.uid) return localRedirect("/login?notice=google-expired", 303);
    try {
      await db.user.update({ where: { id: s.userId }, data: { googleSub: ticket.sub, googleEmail: ticket.email } });
    } catch {
      return localRedirect("/account/security?notice=google-taken", 303);
    }
    await audit(db, { actorId: s.userId, action: "auth.google_linked", entity: "User", entityId: s.userId, after: { googleEmail: ticket.email }, ip });
    return localRedirect("/account/security?notice=google-linked", 303);
  }

  // The login linked to this Google account; else one whose email is this address (linked now).
  let user = await db.user.findFirst({ where: { googleSub: ticket.sub, isSupport: false } });
  if (!user) {
    const byEmail = await db.user.findFirst({ where: { email: { equals: ticket.email, mode: "insensitive" }, googleSub: null, isSupport: false } });
    if (byEmail) {
      user = await db.user.update({ where: { id: byEmail.id }, data: { googleSub: ticket.sub, googleEmail: ticket.email } });
      await audit(db, { actorId: user.id, action: "auth.google_linked", entity: "User", entityId: user.id, after: { googleEmail: ticket.email, byEmail: true }, ip });
    }
  }
  if (!user) return localRedirect("/login?notice=google-none", 303);
  if (!user.active) return localRedirect("/login?notice=google-inactive", 303);
  if (tenant.status === "SUSPENDED" && user.role !== "ADMIN") return localRedirect("/login?notice=google-paused", 303);

  await audit(db, { actorId: user.id, action: "auth.google", entity: "User", entityId: user.id, ip });
  return localRedirect(await finishSignIn(tenant.id, user.id, "google"), 303);
}
