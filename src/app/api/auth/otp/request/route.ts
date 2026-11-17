import { NextResponse } from "next/server";
import { issueOtp } from "@/lib/otp";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const phone = body?.phone?.trim();
  if (!phone || !/^\d{10}$/.test(phone)) {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 }
    );
  }

  const code = issueOtp(phone);

  // No SMS gateway is wired up for this demo — the code is returned directly
  // instead of being texted, so it can still be exercised end to end.
  return NextResponse.json({ ok: true, devCode: code });
}
