import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { requestIp } from "@/lib/audit";
import { requestSignupOtp, SignupError } from "@/lib/signup";

/** Body: { phone } → { challengeId, devCode? } (devCode only in dev / OTP_DEV_MODE). */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  try {
    return NextResponse.json(await requestSignupOtp(String(body?.phone ?? ""), requestIp(req)));
  } catch (e) {
    if (e instanceof SignupError) return NextResponse.json({ error: e.message, field: e.field }, { status: e.status });
    throw e;
  }
}
