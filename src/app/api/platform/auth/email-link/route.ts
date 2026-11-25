import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTenant } from "@/lib/tenant";
import { requestIp } from "@/lib/audit";
import { localRedirect } from "@/lib/redirect";
import { platformAudit } from "@/lib/platform-auth";
import { platformStepOne } from "@/lib/platform-mfa";
import { readPlatformSignInLink, spendPlatformSignInLink } from "@/lib/email-auth";

/** GET ?t= on the console address: a one-click sign-in link; the authenticator code still follows. */
export async function GET(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = await readPlatformSignInLink(new URL(req.url).searchParams.get("t"));
  const u = r ? await prisma.platformUser.findUnique({ where: { id: r.platformUserId }, select: { id: true, active: true } }) : null;
  if (!r || !u?.active || !(await spendPlatformSignInLink(r.id, u.id))) return localRedirect("/platform/login?notice=link-expired", 303);
  const to = await platformStepOne({ platformUserId: u.id, via: "email" });
  await platformAudit(u.id, "auth.email_link", { ip: requestIp(req) ?? undefined });
  return localRedirect(to, 303);
}
