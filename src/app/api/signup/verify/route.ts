import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { SignupError, verifySignupOtp } from "@/lib/signup";

/** Body: { challengeId, code } → { ok, phone } */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  try {
    const r = await verifySignupOtp(String(body?.challengeId ?? ""), String(body?.code ?? ""));
    return NextResponse.json({ ok: true, phone: r.phone });
  } catch (e) {
    if (e instanceof SignupError) return NextResponse.json({ error: e.message, field: e.field }, { status: e.status });
    throw e;
  }
}
