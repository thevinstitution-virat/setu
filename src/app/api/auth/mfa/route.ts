import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { audit, requestIp } from "@/lib/audit";
import { lockedMessage, loginLocked, recordLogin } from "@/lib/login-limit";
import { consumeVerifiedPhone, issueOtp, OtpError, verifyOtp } from "@/lib/otp";
import { otpauthUrl } from "@/lib/totp";
import { checkSecondFactor, completeSignIn, confirmSetup, readPending, smsFallbackAllowed, startSetup, tenantMfaStore } from "@/lib/mfa";

/**
 * The second step on a business address (the person is half signed in, see
 * lib/mfa.ts). Body { action }:
 *   setup   — first time: a new authenticator secret + QR code
 *   confirm — { code } from the new app: saves it, returns recovery codes, signs in
 *   verify  — { code } from the app, or a recovery code; or { smsCode }
 *   sms     — sends a code to the phone on file (not after a mobile-OTP step one)
 * Wrong codes count like wrong passwords: 5 in 15 minutes lock this login.
 */
export async function POST(req: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const pending = await readPending(tenant.id);
  if (!pending) {
    return NextResponse.json({ error: "Your sign-in took too long. Please sign in again.", redirect: "/login?notice=mfa-expired" }, { status: 401 });
  }

  const db = tenantDb(tenant.id);
  const user = await db.user.findUnique({
    where: { id: pending.userId },
    select: { id: true, name: true, phone: true, loginId: true, email: true, active: true, totpEnabledAt: true },
  });
  if (!user?.active) return NextResponse.json({ error: "This account is not active", redirect: "/login" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "");
  const store = tenantMfaStore(db, user.id);
  const ip = requestIp(req);
  const scope = `mfa:${tenant.id}`;

  if (action === "setup") {
    if (user.totpEnabledAt) return NextResponse.json({ error: "The authenticator app is already set up" }, { status: 409 });
    const secret = await startSetup();
    const link = otpauthUrl(secret, user.loginId ?? user.email ?? user.phone ?? user.name, tenant.name);
    const qr = await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 240 });
    return NextResponse.json({ secret, qr, link });
  }

  const wait = await loginLocked(scope, user.id, ip);
  if (wait) return NextResponse.json({ error: lockedMessage(wait) }, { status: 429 });

  if (action === "confirm") {
    if (user.totpEnabledAt) return NextResponse.json({ error: "The authenticator app is already set up" }, { status: 409 });
    const codes = await confirmSetup(store, String(body?.code ?? ""));
    if (!codes) {
      await recordLogin(scope, user.id, ip, false);
      return NextResponse.json({ error: "That code didn't match. Check the time on your phone and try the newest code." }, { status: 400 });
    }
    await recordLogin(scope, user.id, ip, true);
    await audit(db, { actorId: user.id, action: "auth.mfa_enabled", entity: "User", entityId: user.id, ip });
    const redirect = await completeSignIn(pending);
    return NextResponse.json({ recoveryCodes: codes, redirect });
  }

  if (!user.totpEnabledAt) return NextResponse.json({ error: "Set up the authenticator app first" }, { status: 409 });
  const smsOk = smsFallbackAllowed(pending.via) && !!user.phone;

  if (action === "sms") {
    if (!smsOk || !user.phone) return NextResponse.json({ error: "An SMS code can't be used for this sign-in" }, { status: 400 });
    try {
      const { devCode } = await issueOtp(db, user.phone, tenant.name);
      return NextResponse.json({ sent: true, ...(devCode ? { devCode } : {}) });
    } catch (e) {
      if (e instanceof OtpError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  }

  if (action === "verify") {
    let method: string | null = null;
    if (typeof body?.smsCode === "string") {
      if (!smsOk || !user.phone) return NextResponse.json({ error: "An SMS code can't be used for this sign-in" }, { status: 400 });
      try {
        if (await verifyOtp(db, user.phone, body.smsCode.trim())) {
          await consumeVerifiedPhone(db, user.phone);
          method = "sms";
        }
      } catch (e) {
        if (e instanceof OtpError) return NextResponse.json({ error: e.message }, { status: e.status });
        throw e;
      }
    } else {
      method = await checkSecondFactor(store, String(body?.code ?? ""));
    }
    if (!method) {
      await recordLogin(scope, user.id, ip, false);
      return NextResponse.json({ error: "That code didn't work. Try the newest code." }, { status: 400 });
    }
    await recordLogin(scope, user.id, ip, true);
    await audit(db, { actorId: user.id, action: "auth.mfa_ok", entity: "User", entityId: user.id, after: { method, via: pending.via }, ip });
    return NextResponse.json({ redirect: await completeSignIn(pending) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
