import { NextResponse } from "next/server";
import { noticeCode } from "@/lib/login-notices";
import { localRedirect } from "@/lib/redirect";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { finishSignIn } from "@/lib/mfa";
import { consumeHandoff, HandoffError, signHandoff, workspaceUrl, workspacesFor } from "@/lib/handoff";

/** Body: { slug } → { url } to open. Signed hop for OTP sessions, else the other business's login page. */
export async function POST(req: Request) {
  const auth = await guard("attendance.mark");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  const slug = typeof body?.slug === "string" ? body.slug : "";
  const me = await db.user.findUnique({ where: { id: session.userId }, select: { phone: true } });
  if (!me?.phone) return NextResponse.json({ error: "Add your mobile number to your profile first" }, { status: 400 });
  const target = (await workspacesFor(me.phone, tenant.id)).find((w) => w.slug === slug);
  if (!target) return NextResponse.json({ error: "You don't have a login in that business" }, { status: 404 });

  const proven = (session.via === "otp" || session.via === "handoff") && session.phone === me.phone;
  if (!proven) {
    return NextResponse.json({ url: workspaceUrl(req.url, target.slug, `/login?phone=${encodeURIComponent(me.phone)}`), signIn: true });
  }
  const token = await signHandoff(me.phone, tenant.id, target.tenantId);
  await audit(db, { actorId: session.userId, action: "auth.handoff_out", entity: "Tenant", entityId: target.tenantId, ip: requestIp(req) });
  return NextResponse.json({ url: workspaceUrl(req.url, target.slug, `/api/auth/handoff?t=${encodeURIComponent(token)}`), signIn: false });
}

/** ?t=token on the target business: use the token once and sign in. */
export async function GET(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("t") ?? "";
  try {
    const { user, phone } = await consumeHandoff(token, tenant.id);
    // Each business keeps its own two-step set-up: the login here asks for its own code.
    const next = await finishSignIn(tenant.id, user.id, "handoff", { phone });
    await audit(tenantDb(tenant.id), { actorId: user.id, action: "auth.handoff_in", entity: "User", entityId: user.id, ip: requestIp(req) });
    return localRedirect(next, 303);
  } catch (e) {
    if (!(e instanceof HandoffError)) throw e;
    return localRedirect(`/login?error=${noticeCode(e.message, "switch")}`, 303);
  }
}
