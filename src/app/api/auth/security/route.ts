import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { createSessionCookie } from "@/lib/auth";
import { lockedMessage, loginLocked, recordLogin } from "@/lib/login-limit";
import { otpauthUrl } from "@/lib/totp";
import { googleConfigured } from "@/lib/google";
import { checkSecondFactor, confirmSetup, mfaRequired, renewRecoveryCodes, startSetup, tenantMfaStore } from "@/lib/mfa";

/**
 * Sign-in and security for the person signed in (any role), on a business
 * address. GET: status. POST { action }:
 *   setup    — a QR code to turn two-step on (shops; staff already have it)
 *   newPhone — { code } current code, then a QR code for the new phone
 *   confirm  — { code } from the new app: saves it, returns recovery codes
 *   renew    — { code }: new recovery codes (the old ones stop working)
 *   disable  — { code }: shops only; staff can't turn it off
 *   unlinkGoogle
 */
async function auth() {
  const a = await guard();
  if (!a.ok) return a;
  if (a.session.via === "support") return { ok: false as const, res: NextResponse.json({ error: "Not during a support session" }, { status: 403 }) };
  return a;
}

export async function GET() {
  const a = await auth();
  if (!a.ok) return a.res;
  const u = await a.db.user.findUnique({ where: { id: a.session.userId }, select: { role: true, totpEnabledAt: true, recoveryCodes: true, googleEmail: true } });
  if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    required: u.role !== "RETAILER",
    enabled: !!u.totpEnabledAt,
    recoveryLeft: u.recoveryCodes.length,
    googleEmail: u.googleEmail,
    googleAvailable: googleConfigured(),
  });
}

export async function POST(req: Request) {
  const a = await auth();
  if (!a.ok) return a.res;
  const { session, db, tenant } = a;
  const u = await db.user.findUnique({ where: { id: session.userId }, select: { id: true, role: true, name: true, loginId: true, email: true, phone: true, totpEnabledAt: true } });
  if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "");
  const store = tenantMfaStore(db, u.id);
  const ip = requestIp(req);
  const scope = `mfa:${tenant.id}`;

  const qr = async () => {
    const secret = await startSetup();
    const link = otpauthUrl(secret, u.loginId ?? u.email ?? u.phone ?? u.name, tenant.name);
    return NextResponse.json({ secret, qr: await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 240 }), link });
  };

  if (action === "unlinkGoogle") {
    await db.user.update({ where: { id: u.id }, data: { googleSub: null, googleEmail: null } });
    await audit(db, { actorId: u.id, action: "auth.google_unlinked", entity: "User", entityId: u.id, ip });
    return NextResponse.json({ ok: true });
  }

  if (action === "setup") {
    if (u.totpEnabledAt) return NextResponse.json({ error: "Two-step sign-in is already on" }, { status: 409 });
    return qr();
  }

  const wait = await loginLocked(scope, u.id, ip);
  if (wait) return NextResponse.json({ error: lockedMessage(wait) }, { status: 429 });
  const code = String(body?.code ?? "");

  if (action === "confirm") {
    const codes = await confirmSetup(store, code);
    await recordLogin(scope, u.id, ip, !!codes);
    if (!codes) return NextResponse.json({ error: "That code didn't match. Check the time on your phone and try the newest code." }, { status: 400 });
    await audit(db, { actorId: u.id, action: u.totpEnabledAt ? "auth.mfa_new_phone" : "auth.mfa_enabled", entity: "User", entityId: u.id, ip });
    // This session now counts as two-step (a shop turning it on would otherwise be signed out).
    await createSessionCookie({ ...session, mfa: true });
    return NextResponse.json({ recoveryCodes: codes, redirect: "/account/security" });
  }

  if (action !== "newPhone" && action !== "renew" && action !== "disable") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!u.totpEnabledAt) return NextResponse.json({ error: "Two-step sign-in is off" }, { status: 409 });
  if (action === "disable" && mfaRequired(u.role, null)) return NextResponse.json({ error: "Staff logins always use two-step sign-in" }, { status: 403 });

  const ok = !!(await checkSecondFactor(store, code));
  await recordLogin(scope, u.id, ip, ok);
  if (!ok) return NextResponse.json({ error: "That code didn't work. Try the newest code." }, { status: 400 });

  if (action === "newPhone") return qr();
  if (action === "renew") {
    const codes = await renewRecoveryCodes(store);
    await audit(db, { actorId: u.id, action: "auth.recovery_renewed", entity: "User", entityId: u.id, ip });
    return NextResponse.json({ recoveryCodes: codes });
  }
  await db.user.update({ where: { id: u.id }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] } });
  await audit(db, { actorId: u.id, action: "auth.mfa_disabled", entity: "User", entityId: u.id, ip });
  return NextResponse.json({ ok: true });
}
