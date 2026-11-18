import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { isPhoneVerified, consumeVerifiedPhone } from "@/lib/otp";
import { createSessionCookie, roleHome } from "@/lib/auth";
import { audit, requestIp } from "@/lib/audit";
import { emit } from "@/lib/jobs";

export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const db = tenantDb(tenant.id);

  const body = await req.json().catch(() => null);
  const { phone, outletName, shopNumber, complexName, pinCode, areaId } = body ?? {};

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

  const user = await db.user.create({
    data: {
      name: outletName,
      phone,
      role: "RETAILER",
      retailerProfile: { create: { outletName, shopNumber, complexName, pinCode, areaId } },
    },
  });

  await consumeVerifiedPhone(db, phone);
  await audit(db, { actorId: user.id, action: "retailer.register", entity: "User", entityId: user.id, after: { phone, outletName, areaId }, ip: requestIp(req) });
  await emit("retailer.registered", { tenantId: tenant.id, userId: user.id });
  await createSessionCookie({ userId: user.id, tenantId: tenant.id, role: user.role, name: user.name });

  return NextResponse.json({ ok: true, redirect: roleHome(user.role) });
}
