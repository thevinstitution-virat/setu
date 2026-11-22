import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { getTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { requestIp } from "@/lib/audit";
import { lockedMessage, loginLocked, recordLogin } from "@/lib/login-limit";
import { otpauthUrl } from "@/lib/totp";
import { checkSecondFactor, confirmSetup, startSetup } from "@/lib/mfa";
import { platformAudit } from "@/lib/platform-auth";
import { completePlatformSignIn, platformMfaStore, readPlatformPending } from "@/lib/platform-mfa";

/** The console's second step (lib/platform-mfa.ts). Body { action: setup | confirm | verify, code? }. */
export async function POST(req: Request) {
  if (await getTenant()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pending = await readPlatformPending();
  if (!pending) return NextResponse.json({ error: "Your sign-in took too long. Please sign in again.", redirect: "/platform/login" }, { status: 401 });
  const u = await prisma.platformUser.findUnique({ where: { id: pending.platformUserId }, select: { id: true, email: true, active: true, totpEnabledAt: true } });
  if (!u?.active) return NextResponse.json({ error: "This console login is switched off", redirect: "/platform/login" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "");
  const store = platformMfaStore(u.id);
  const ip = requestIp(req);

  if (action === "setup") {
    if (u.totpEnabledAt) return NextResponse.json({ error: "The authenticator app is already set up" }, { status: 409 });
    const secret = await startSetup();
    const link = otpauthUrl(secret, u.email, "VBiz Pro console");
    return NextResponse.json({ secret, qr: await QRCode.toDataURL(link, { errorCorrectionLevel: "M", margin: 1, width: 240 }), link });
  }

  if (action !== "confirm" && action !== "verify") return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  const wait = await loginLocked("platform-mfa", u.id, ip);
  if (wait) return NextResponse.json({ error: lockedMessage(wait) }, { status: 429 });

  const code = String(body?.code ?? "");
  let codes: string[] | null = null;
  let ok: boolean;
  if (action === "confirm") {
    if (u.totpEnabledAt) return NextResponse.json({ error: "The authenticator app is already set up" }, { status: 409 });
    codes = await confirmSetup(store, code);
    ok = !!codes;
  } else {
    if (!u.totpEnabledAt) return NextResponse.json({ error: "Set up the authenticator app first" }, { status: 409 });
    ok = !!(await checkSecondFactor(store, code));
  }
  await recordLogin("platform-mfa", u.id, ip, ok);
  if (!ok) {
    await platformAudit(u.id, "auth.mfa_failed", { ip });
    return NextResponse.json({ error: "That code didn't work. Try the newest code." }, { status: 400 });
  }
  if (!(await completePlatformSignIn(pending))) return NextResponse.json({ error: "This console login is switched off", redirect: "/platform/login" }, { status: 401 });
  await platformAudit(u.id, action === "confirm" ? "auth.mfa_enabled" : "auth.login", { detail: { via: pending.via }, ip });
  return NextResponse.json({ redirect: "/platform", ...(codes ? { recoveryCodes: codes } : {}) });
}
