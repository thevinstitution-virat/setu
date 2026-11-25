import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { createSessionCookie, roleHome } from "@/lib/auth";
import { checkLimit, LimitError } from "@/lib/plans";
import { checkStaffFields } from "@/lib/staff";
import { withTenantTx } from "@/lib/db";
import { attachReferral, lookupCode } from "@/lib/referrals";
import { referralSettings } from "@/lib/engage-settings";
import { MoneyError } from "@/lib/money-error";
import { emit } from "@/lib/jobs";

/**
 * The first-sign-in form for the signed-in person's role. Everyone gives a name and a mobile
 * number; a shopkeeper also gives the shop's details (which makes the shop). Saving clears
 * the "form due" flag and returns the person's own dashboard.
 */
export async function POST(req: Request) {
  const a = await guard();
  if (!a.ok) return a.res;
  const { session, db, tenant } = a;
  if (session.via === "support") return NextResponse.json({ error: "Not during a support session" }, { status: 403 });

  const body = (await req.json().catch(() => null)) ?? {};
  const user = await db.user.findUnique({ where: { id: session.userId }, select: { id: true, role: true, name: true, onboardingDue: true, retailerProfile: { select: { id: true } } } });
  if (!user) return NextResponse.json({ error: "Please sign in again" }, { status: 401 });
  if (!user.onboardingDue) return NextResponse.json({ ok: true, redirect: roleHome(user.role) });

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return NextResponse.json({ error: "Please tell us your name" }, { status: 400 });
  const phoneField = await checkStaffFields(db, user.id, { phone: body.phone });
  if ("error" in phoneField) return NextResponse.json({ error: phoneField.error }, { status: 400 });
  if (!phoneField.data.phone) return NextResponse.json({ error: "Enter your 10-digit mobile number" }, { status: 400 });

  let referralOn = false;
  let hasCode = false;
  let shop: { outletName: string; shopNumber: string; complexName: string; pinCode: string; areaId: string } | null = null;

  if (user.role === "RETAILER" && !user.retailerProfile) {
    const { outletName, shopNumber, complexName, pinCode, areaId, referralCode } = body;
    if (![outletName, shopNumber, complexName, pinCode, areaId].every((v) => typeof v === "string" && v.trim())) {
      return NextResponse.json({ error: "Please fill in every shop detail" }, { status: 400 });
    }
    if (!/^\d{6}$/.test(String(pinCode).trim())) return NextResponse.json({ error: "Enter the 6-digit PIN code" }, { status: 400 });
    const area = await db.area.findUnique({ where: { id: String(areaId) }, select: { id: true } });
    if (!area) return NextResponse.json({ error: "Choose your area" }, { status: 400 });
    referralOn = referralSettings(tenant.settings).on;
    hasCode = referralOn && typeof referralCode === "string" && referralCode.trim() !== "";
    if (hasCode) {
      try {
        await withTenantTx(tenant.id, (tx) => lookupCode(tx, tenant.id, referralCode));
      } catch (e) {
        if (e instanceof MoneyError) return NextResponse.json({ error: e.message, status: e.status }, { status: e.status });
        throw e;
      }
    }
    try {
      await checkLimit(db, tenant.id, "retailers");
    } catch (e) {
      if (e instanceof LimitError) return NextResponse.json({ error: "This business is not taking new shops online right now. Please call the office.", code: "limit" }, { status: 402 });
      throw e;
    }
    shop = { outletName: String(outletName).trim().slice(0, 100), shopNumber: String(shopNumber).trim().slice(0, 40), complexName: String(complexName).trim().slice(0, 100), pinCode: String(pinCode).trim(), areaId: area.id };
  }

  await db.user.update({
    where: { id: user.id },
    data: { name, phone: phoneField.data.phone, onboardingDue: false, ...(shop ? { retailerProfile: { create: shop } } : {}) },
  });

  if (shop) {
    if (hasCode) {
      const profile = await db.retailerProfile.findUniqueOrThrow({ where: { userId: user.id }, select: { id: true } });
      await withTenantTx(tenant.id, (tx) => attachReferral(tx, tenant.id, profile.id, body.referralCode)).catch((e) => console.error("[referral] not linked", e));
    }
    await emit("retailer.registered", { tenantId: tenant.id, userId: user.id });
  }
  await audit(db, { actorId: user.id, action: "auth.onboarded", entity: "User", entityId: user.id, after: { role: user.role }, ip: requestIp(req) });
  // The cookie carries the name, so refresh it.
  await createSessionCookie({ userId: user.id, tenantId: tenant.id, role: user.role, name, via: session.via, phone: session.phone, mfa: session.mfa });
  return NextResponse.json({ ok: true, redirect: roleHome(user.role) });
}
