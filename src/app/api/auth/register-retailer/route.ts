import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { isPhoneVerified, consumeVerifiedPhone } from "@/lib/otp";
import { createSessionCookie, roleHome } from "@/lib/auth";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";
import { withTenantTx } from "@/lib/db";
import { attachReferral, lookupCode } from "@/lib/referrals";
import { MoneyError } from "@/lib/money-error";
import { referralSettings } from "@/lib/engage-settings";

export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const db = tenantDb(tenant.id);

  const body = await req.json().catch(() => null);
  const { phone, outletName, shopNumber, complexName, pinCode, areaId, referralCode } = body ?? {};

  if (!phone || !outletName || !shopNumber || !complexName || !pinCode || !areaId) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  if (!(await isPhoneVerified(db, phone))) {
    return NextResponse.json({ error: "Phone not verified. Please verify OTP again." }, { status: 400 });
  }

  const area = await db.area.findUnique({ where: { id: areaId } });
  if (!area) return NextResponse.json({ error: "Invalid area" }, { status: 400 });

  const taken = await db.user.findFirst({ where: { phone } });
  if (taken) return NextResponse.json({ error: "This number is already registered" }, { status: 400 });

  // A friend's code (refer and earn): checked before the shop is made, so a typo never half-registers.
  // With the feature off, an old shared link's code is ignored rather than blocking sign-up.
  const referralOn = referralSettings(tenant.settings).on;
  const hasCode = referralOn && typeof referralCode === "string" && referralCode.trim() !== "";
  if (hasCode) {
    try {
      await withTenantTx(tenant.id, (tx) => lookupCode(tx, tenant.id, referralCode));
    } catch (e) {
      if (e instanceof MoneyError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  }

  const user = await db.user.create({
    data: {
      name: outletName,
      phone,
      role: "RETAILER",
      retailerProfile: { create: { outletName, shopNumber, complexName, pinCode, areaId } },
    },
  });

  if (hasCode) {
    const profile = await db.retailerProfile.findUniqueOrThrow({ where: { userId: user.id }, select: { id: true } });
    // The shop is made either way; a code that stopped working in between is just not linked.
    await withTenantTx(tenant.id, (tx) => attachReferral(tx, tenant.id, profile.id, referralCode)).catch((e) => console.error("[referral] not linked", e));
  }
  await consumeVerifiedPhone(db, phone);
  await audit(db, { actorId: user.id, action: "retailer.register", entity: "User", entityId: user.id, after: { phone, outletName, areaId }, ip: requestIp(req) });
  await emit("retailer.registered", { tenantId: tenant.id, userId: user.id });
  await createSessionCookie({ userId: user.id, tenantId: tenant.id, role: user.role, name: user.name });

  return NextResponse.json({ ok: true, redirect: roleHome(user.role) });
}
