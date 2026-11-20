import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { withTenantTx } from "@/lib/db";
import { lookupCode } from "@/lib/referrals";
import { MoneyError } from "@/lib/money-error";
import { requestIp } from "@/lib/audit";
import { HOUR, limited } from "@/lib/rate-limit";

/**
 * GET ?code= → { ok, shop } before signing up (no sign-in). Only the
 * referring shop's name comes back: enough for "Code from Gupta Kirana".
 */
export async function GET(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  // No sign-in here: cap guesses per address so codes (and shop names) can't be walked.
  const ip = requestIp(req);
  if (ip && (await limited("referral-check-ip", ip, 30, HOUR))) {
    return NextResponse.json({ error: "Too many tries. Try again in an hour." }, { status: 429 });
  }
  const code = new URL(req.url).searchParams.get("code");
  try {
    const r = await withTenantTx(tenant.id, (tx) => lookupCode(tx, tenant.id, code));
    return NextResponse.json({ ok: true, code: r.code, shop: r.outletName });
  } catch (e) {
    if (e instanceof MoneyError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
