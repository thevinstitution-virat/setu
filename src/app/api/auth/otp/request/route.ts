import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { issueOtp, OtpError } from "@/lib/otp";

export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  // A paused business: shops and staff can't sign in, so don't spend an SMS on a code.
  if (tenant.status === "SUSPENDED") return NextResponse.json({ error: "This business is paused. The owner can sign in to see why." }, { status: 423 });

  const body = await req.json().catch(() => null);
  const phone = body?.phone?.trim();
  if (!phone || !/^\d{10}$/.test(phone)) {
    return NextResponse.json({ error: "Enter a valid 10-digit mobile number" }, { status: 400 });
  }

  try {
    const { devCode } = await issueOtp(tenantDb(tenant.id), phone, tenant.name);
    // devCode is only present in dev / OTP_DEV_MODE (no SMS provider yet).
    return NextResponse.json({ ok: true, ...(devCode ? { devCode } : {}) });
  } catch (e) {
    if (e instanceof OtpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
