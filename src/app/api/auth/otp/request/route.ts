import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { issueOtp, OtpError } from "@/lib/otp";
import { requestIp } from "@/lib/audit";
import { DAY, HOUR, limited } from "@/lib/rate-limit";

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

  // Codes cost an SMS each: cap per network address and per phone per day
  // (issueOtp also allows 3 per phone per 10 minutes).
  const ip = requestIp(req);
  if ((ip && (await limited("otp-send-ip", ip, 20, HOUR))) || (await limited(`otp-send-day:${tenant.id}`, phone, 10, DAY))) {
    return NextResponse.json({ error: "Too many codes asked for. Please try again later." }, { status: 429 });
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
