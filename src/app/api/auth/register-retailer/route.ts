import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPhoneVerified, consumeVerifiedPhone } from "@/lib/otp";
import { createSessionCookie, roleHome } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const { phone, outletName, shopNumber, complexName, pinCode, areaId } = body ?? {};

  if (!phone || !outletName || !shopNumber || !complexName || !pinCode || !areaId) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  if (!isPhoneVerified(phone)) {
    return NextResponse.json(
      { error: "Phone not verified. Please verify OTP again." },
      { status: 400 }
    );
  }

  const area = await prisma.area.findUnique({ where: { id: areaId } });
  if (!area) {
    return NextResponse.json({ error: "Invalid area" }, { status: 400 });
  }

  const user = await prisma.user.create({
    data: {
      name: outletName,
      phone,
      role: "RETAILER",
      retailerProfile: {
        create: { outletName, shopNumber, complexName, pinCode, areaId },
      },
    },
  });

  consumeVerifiedPhone(phone);
  await createSessionCookie({ userId: user.id, role: user.role, name: user.name });

  return NextResponse.json({ ok: true, redirect: roleHome(user.role) });
}
