import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { moneySettings, parseMoneySettings } from "@/lib/money-settings";
import { invalidateTenantCache } from "@/lib/tenant";

/** Business settings. Phase 1 covers money rules (settings.money). */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } }));
  return NextResponse.json({ money: moneySettings(t.settings) });
}

export async function PATCH(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  if (!body?.money || typeof body.money !== "object") return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  const patch = parseMoneySettings(body.money);
  if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });

  // Tenant is a platform table (no RLS row filter), so update by id under the platform role.
  const { before, after } = await asPlatform(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } });
    const settings = (t.settings ?? {}) as Record<string, unknown>;
    const before = moneySettings(settings);
    const money = { ...before, ...patch };
    await tx.tenant.update({ where: { id: tenant.id }, data: { settings: { ...settings, money } } });
    return { before, after: money };
  });
  invalidateTenantCache(tenant.id);
  await audit(db, { actorId: session.userId, action: "settings.money", entity: "Tenant", entityId: tenant.id, before, after, ip: requestIp(req) });
  return NextResponse.json({ money: after });
}
