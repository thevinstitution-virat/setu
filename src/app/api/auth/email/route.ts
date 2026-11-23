import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { HOUR, limited } from "@/lib/rate-limit";
import { checkEmailCode, EmailAuthError, issueEmailCode, normaliseEmail, validEmail } from "@/lib/email-auth";
import { EmailError, emailDevMode, sendEmail } from "@/lib/email";
import { verifyCodeMail } from "@/lib/email-messages";

/**
 * The signed-in person's own email address (Security page), any role.
 * POST { action }:
 *   send    — { email }: a code to that address (it isn't saved yet)
 *   confirm — { code }: saves the address as verified
 *   remove  — forgets the address (no more email codes or reset links)
 */
export async function POST(req: Request) {
  const a = await guard();
  if (!a.ok) return a.res;
  const { session, db, tenant } = a;
  if (session.via === "support") return NextResponse.json({ error: "Not during a support session" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const action = String(body?.action ?? "");
  const ip = requestIp(req);

  try {
    if (action === "send") {
      const email = normaliseEmail(body?.email);
      if (!validEmail(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
      if (await limited("email-verify-user", session.userId, 6, HOUR)) return NextResponse.json({ error: "Too many codes asked for. Please try again later." }, { status: 429 });
      const taken = await db.user.findFirst({
        where: { id: { not: session.userId }, email: { equals: email, mode: "insensitive" }, emailVerifiedAt: { not: null } },
        select: { id: true },
      });
      if (taken) return NextResponse.json({ error: "Another login here already uses this email address" }, { status: 409 });
      const code = await issueEmailCode(db, session.userId, email, "VERIFY");
      await sendEmail(verifyCodeMail(email, tenant.name, code));
      return NextResponse.json({ ok: true, email, ...(emailDevMode() ? { devCode: code } : {}) });
    }

    if (action === "confirm") {
      const c = await checkEmailCode(db, { userId: session.userId, purpose: "VERIFY", code: String(body?.code ?? "") });
      if (!c) return NextResponse.json({ error: "That code is wrong or has expired" }, { status: 400 });
      try {
        await db.user.update({ where: { id: session.userId }, data: { email: c.email, emailVerifiedAt: new Date() } });
      } catch (e) {
        // User_verified_email_once: someone else verified it in the meantime.
        if ((e as { code?: string })?.code === "P2002") return NextResponse.json({ error: "Another login here already uses this email address" }, { status: 409 });
        throw e;
      }
      await audit(db, { actorId: session.userId, action: "auth.email_verified", entity: "User", entityId: session.userId, ip });
      return NextResponse.json({ ok: true, email: c.email });
    }

    if (action === "remove") {
      await db.user.update({ where: { id: session.userId }, data: { email: null, emailVerifiedAt: null } });
      await audit(db, { actorId: session.userId, action: "auth.email_removed", entity: "User", entityId: session.userId, ip });
      return NextResponse.json({ ok: true });
    }
  } catch (e) {
    if (e instanceof EmailAuthError || e instanceof EmailError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
