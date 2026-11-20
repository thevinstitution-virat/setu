import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { requestIp } from "@/lib/audit";
import { signup, SignupError, tenantAddress } from "@/lib/signup";

/**
 * Self-serve sign-up (platform address only). Body: businessName, legalName?,
 * gstin?, stateCode, address?, slug, ownerName, loginId, password, planCode?,
 * acceptTerms, challengeId (a verified phone check).
 * → { slug, url } — open url to sign in on the new address.
 */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Send the form as JSON" }, { status: 400 });
  try {
    const r = await signup(body, requestIp(req));
    return NextResponse.json({ slug: r.tenant.slug, url: tenantAddress(req.url, r.tenant.slug, `/api/auth/welcome?t=${encodeURIComponent(r.token)}`) }, { status: 201 });
  } catch (e) {
    if (e instanceof SignupError) return NextResponse.json({ error: e.message, field: e.field }, { status: e.status });
    throw e;
  }
}
