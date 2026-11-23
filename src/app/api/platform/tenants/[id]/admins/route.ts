import { NextResponse } from "next/server";
import { requestIp } from "@/lib/audit";
import { platformAudit, platformGuard } from "@/lib/platform-auth";
import { addAdmin, adminPasswordLink, ConsoleAdminError, listAdmins, makeOwner, resetAdminTwoStep, setAdminActive, setAdminEmail } from "@/lib/console-admins";

/** The business's admins (owner first). */
export async function GET(_req: Request, ctx: RouteContext<"/api/platform/tenants/[id]/admins">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  return NextResponse.json({ admins: await listAdmins(id) });
}

/**
 * Super-admin (console OWNER) only. Body { action, ... }:
 *   add      { name, loginId, phone?, email? } → { url, emailed }  a new admin + set-password link
 *   link     { userId }                       → { url, emailed }  a new set-password link (3 days)
 *   reset2fa { userId }                        clear their authenticator app, sign them out
 *   active   { userId, active }                switch an admin off or on (never the owner)
 *   owner    { userId }                        make this admin the business owner
 *   email    { userId, email }                 set (or clear, "") their confirmed email: how they sign in for now
 */
export async function POST(req: Request, ctx: RouteContext<"/api/platform/tenants/[id]/admins">) {
  const g = await platformGuard("OWNER");
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const userId = typeof body?.userId === "string" ? body.userId : "";
  const audit = (action: string, detail: Record<string, string | boolean>) =>
    platformAudit(g.session.platformUserId, action, {
      tenantId: id,
      detail,
      ip: requestIp(req),
    });
  try {
    switch (body?.action) {
      case "add": {
        const r = await addAdmin(id, body);
        await audit("tenant.admin_add", {
          userId: r.adminId,
          loginId: String(body.loginId ?? ""),
        });
        return NextResponse.json({ url: r.url, emailed: r.emailed }, { status: 201 });
      }
      case "link": {
        const r = await adminPasswordLink(id, userId);
        await audit("tenant.admin_password_link", {
          userId,
          emailed: r.emailed,
        });
        return NextResponse.json(r);
      }
      case "reset2fa":
        await resetAdminTwoStep(id, userId);
        await audit("tenant.admin_mfa_reset", { userId });
        return NextResponse.json({ ok: true });
      case "active":
        await setAdminActive(id, userId, body.active === true);
        await audit("tenant.admin_active", {
          userId,
          active: body.active === true,
        });
        return NextResponse.json({ ok: true });
      case "email":
        await setAdminEmail(id, userId, body.email);
        await audit("tenant.admin_email", { userId, set: !!(typeof body.email === "string" && body.email.trim()) });
        return NextResponse.json({ ok: true });
      case "owner":
        await makeOwner(id, userId);
        await audit("tenant.owner_change", { userId });
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ConsoleAdminError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
