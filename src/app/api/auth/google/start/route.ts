import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { localRedirect } from "@/lib/redirect";
import { pageSession } from "@/lib/guard";
import { googleConfigured, googleStartUrl } from "@/lib/google";

/**
 * "Continue with Google" on a business address. ?intent=link (from the
 * Security page) connects Google to the login already signed in.
 */
export async function GET(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return localRedirect("/");
  if (!googleConfigured()) return localRedirect("/login?notice=google-off");
  const intent = new URL(req.url).searchParams.get("intent") === "link" ? "link" : "signin";
  let uid: string | undefined;
  if (intent === "link") {
    const s = await pageSession();
    if (!s || s.via === "support") return localRedirect("/login");
    uid = s.userId;
  }
  const h = await headers();
  const host = (h.get("host") ?? "").split(",")[0].trim().toLowerCase();
  const url = await googleStartUrl({ k: "tenant", intent, tenantId: tenant.id, host, uid });
  return NextResponse.redirect(url, 303);
}
