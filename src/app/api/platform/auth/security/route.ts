import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/audit";
import { lockedMessage, loginLocked, recordLogin } from "@/lib/login-limit";
import { otpauthUrl } from "@/lib/totp";
import { checkSecondFactor, confirmSetup, renewRecoveryCodes, startSetup } from "@/lib/mfa";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { platformMfaStore } from "@/lib/platform-mfa";

/**
 * The console login's own security (always two-step). POST { action }:
 * newPhone { code } → QR for the new phone; confirm { code } → saves it,
 * recovery codes; renew { code } → new recovery codes; unlinkGoogle.
 */
export async function POST(req: Request) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const id = g.session.platformUserId;
  const u = await prisma.platformUser.findUnique({ where: { id }, select: { email: true } });
  if (!u) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "");
  const store = platformMfaStore(id);
  const ip = requestIp(req);

  if (action === "unlinkGoogle") {
    await prisma.platformUser.update({ where: { id }, data: { googleSub: null, googleEmail: null } });
    await platformAudit(id, "auth.google_unlinked", { ip });
    return NextResponse.json({ ok: true });
  }
  if (!["newPhone", "confirm", "renew"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const wait = await loginLocked("platform-mfa", id, ip);
  if (wait) return NextResponse.json({ error: lockedMessage(wait) }, { status: 429 });
  const code = String(body?.code ?? "");

  if (action === "confirm") {
    const codes = await confirmSetup(store, code);
    await recordLogin("platform-mfa", id, ip, !!codes);
    if (!codes) return NextResponse.json({ error: "That code didn't match. Check the time on your phone and try the newest code." }, { status: 400 });
    await platformAudit(id, "auth.mfa_new_phone", { ip });
    return NextResponse.json({ recoveryCodes: codes, redirect: "/platform/security" });
  }

  const ok = !!(await checkSecondFactor(store, code));
  await recordLogin("platform-mfa", id, ip, ok);
  if (!ok) return NextResponse.json({ error: "That code didn't work. Try the newest code." }, { status: 400 });
  if (action === "newPhone") {
    const secret = await startSetup();
    const link = otpauthUrl(secret, u.email, "VBiz Pro console");
    return NextResponse.json({ secret, qr: await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 240 }), link });
  }
  const codes = await renewRecoveryCodes(store);
  await platformAudit(id, "auth.recovery_renewed", { ip });
  return NextResponse.json({ recoveryCodes: codes });
}
