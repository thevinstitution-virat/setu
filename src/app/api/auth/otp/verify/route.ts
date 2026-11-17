import { NextResponse } from "next/server";
import { verifyOtp } from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { createSessionCookie, roleHome } from "@/lib/auth";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const phone = body?.phone?.trim();
  const code = body?.code?.trim();
  if (!phone || !code) {
    return NextResponse.json({ error: "Missing phone or code" }, { status: 400 });
  }

  const ok = verifyOtp(phone, code);
  if (!ok) {
    return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { phone },
    include: { retailerProfile: true },
  });

  if (existing && existing.retailerProfile) {
    await createSessionCookie({
      userId: existing.id,
      role: existing.role,
      name: existing.name,
    });
    return NextResponse.json({ status: "login", redirect: roleHome(existing.role) });
  }

  return NextResponse.json({ status: "new", phone });
}
