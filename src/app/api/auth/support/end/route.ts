import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { clearSessionCookie, getSession } from "@/lib/auth";
import { endSupport } from "@/lib/support";

/** End the support session this browser is in and sign out. */
export async function POST() {
  const tenant = await getTenant();
  const session = await getSession();
  if (tenant && session?.supportId) await endSupport(tenant.id, session.supportId, "support (signed out)");
  await clearSessionCookie();
  return NextResponse.json({ ok: true, redirect: "/login" });
}
