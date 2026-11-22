import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { verifyOtp, consumeVerifiedPhone, OtpError } from "@/lib/otp";
import { finishSignIn } from "@/lib/mfa";
import { isFieldRole } from "@/lib/field-settings";
import { requestIp } from "@/lib/audit";
import { HOUR, limited } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const db = tenantDb(tenant.id);
  // OTP sign-in is for shops and field staff; a paused business takes neither.
  if (tenant.status === "SUSPENDED") {
    return NextResponse.json({ error: "This business is paused. Please contact the office.", code: "paused" }, { status: 423 });
  }

  const body = await req.json().catch(() => null);
  const phone = body?.phone?.trim();
  const code = body?.code?.trim();
  if (!phone || !code) {
    return NextResponse.json({ error: "Missing phone or code" }, { status: 400 });
  }

  // Each code allows 5 tries; this caps guessing across many phones from one address.
  const ip = requestIp(req);
  if (ip && (await limited("otp-check-ip", ip, 60, HOUR))) {
    return NextResponse.json({ error: "Too many tries from this network. Please wait an hour." }, { status: 429 });
  }

  try {
    if (!(await verifyOtp(db, phone, code))) {
      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof OtpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  // Shops and field staff sign in with OTP. Field staff with this phone win
  // (a phone can be both a shop and a staff member only by mistake).
  const users = await db.user.findMany({ where: { phone, isSupport: false }, include: { retailerProfile: true } });
  // The staff form sends as: "staff" so a shop's mobile typed there never signs in as the shop.
  const staffOnly = body?.as === "staff";
  const existing = users.find((u) => isFieldRole(u.role)) ?? (staffOnly ? null : users.find((u) => u.retailerProfile)) ?? null;

  if (existing) {
    if (!existing.active) {
      return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
    }
    await consumeVerifiedPhone(db, phone);
    // Staff (and shops that turned it on) still need the code from their authenticator app.
    const redirect = await finishSignIn(tenant.id, existing.id, "otp", { phone });
    return NextResponse.json({ status: "login", redirect });
  }

  return NextResponse.json({ status: "new", phone });
}
