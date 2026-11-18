import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { verifyOtp, consumeVerifiedPhone, OtpError } from "@/lib/otp";
import { createSessionCookie, roleHome } from "@/lib/auth";

export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const db = tenantDb(tenant.id);

  const body = await req.json().catch(() => null);
  const phone = body?.phone?.trim();
  const code = body?.code?.trim();
  if (!phone || !code) {
    return NextResponse.json({ error: "Missing phone or code" }, { status: 400 });
  }

  try {
    if (!(await verifyOtp(db, phone, code))) {
      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof OtpError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }

  const existing = await db.user.findFirst({ where: { phone }, include: { retailerProfile: true } });

  if (existing && existing.retailerProfile) {
    if (!existing.active) {
      return NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
    }
    await consumeVerifiedPhone(db, phone);
    await createSessionCookie({
      userId: existing.id,
      tenantId: tenant.id,
      role: existing.role,
      name: existing.name,
    });
    return NextResponse.json({ status: "login", redirect: roleHome(existing.role) });
  }

  return NextResponse.json({ status: "new", phone });
}
