import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { audit, requestIp } from "@/lib/audit";
import { localRedirect } from "@/lib/redirect";
import { readSignInLink, spendSignInLink } from "@/lib/email-auth";
import { finishSignIn } from "@/lib/mfa";

/** GET ?t= on a business address: a one-click sign-in link from the email (staff then give their authenticator code). */
export async function GET(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const db = tenantDb(tenant.id);
  const c = await readSignInLink(db, new URL(req.url).searchParams.get("t"));
  if (!c) return localRedirect("/login?notice=link-expired", 303);
  const user = await db.user.findUnique({ where: { id: c.userId }, select: { id: true, role: true, active: true, email: true, emailVerifiedAt: true } });
  // The address must still be this login's confirmed one, and the login still on.
  const ok = !!user && user.active && !!user.emailVerifiedAt && user.email?.toLowerCase() === c.email && (tenant.status !== "SUSPENDED" || user.role === "ADMIN");
  if (!ok || !(await spendSignInLink(db, c.id, c.userId))) return localRedirect("/login?notice=link-expired", 303);
  await audit(db, { actorId: user.id, action: "auth.email_link", entity: "User", entityId: user.id, ip: requestIp(req) });
  return localRedirect(await finishSignIn(tenant.id, user.id, "email"), 303);
}
