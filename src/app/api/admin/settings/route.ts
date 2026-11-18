import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { moneySettings, parseMoneySettings } from "@/lib/money-settings";
import { cartSettings, parseCartSettings } from "@/lib/cart-settings";
import { invalidateTenantCache } from "@/lib/tenant";

/** Business settings: money rules (settings.money) and cart rules (settings.cart). */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } }));
  return NextResponse.json({ money: moneySettings(t.settings), cart: cartSettings(t.settings) });
}

const SECTIONS = {
  money: { read: moneySettings, parse: parseMoneySettings },
  cart: { read: cartSettings, parse: parseCartSettings },
} as const;

/** Body: { money?: {...}, cart?: {...} } — only the fields sent change. */
export async function PATCH(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  const keys = (Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]).filter((k) => body?.[k] && typeof body[k] === "object");
  if (!keys.length) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  const patches: Record<string, object> = {};
  for (const k of keys) {
    const patch = SECTIONS[k].parse(body[k]);
    if (typeof patch === "string") return NextResponse.json({ error: patch }, { status: 400 });
    patches[k] = patch;
  }

  // Tenant is a platform table (no RLS row filter), so update by id under the platform role.
  const { before, after } = await asPlatform(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } });
    const settings = (t.settings ?? {}) as Record<string, unknown>;
    const before: Record<string, unknown> = {};
    const next: Record<string, unknown> = { ...settings };
    for (const k of keys) {
      before[k] = SECTIONS[k].read(settings);
      next[k] = { ...(before[k] as object), ...patches[k] };
    }
    await tx.tenant.update({ where: { id: tenant.id }, data: { settings: next as object } });
    return { before, after: Object.fromEntries(keys.map((k) => [k, next[k]])) };
  });
  invalidateTenantCache(tenant.id);
  await audit(db, { actorId: session.userId, action: `settings.${keys.join("+")}`, entity: "Tenant", entityId: tenant.id, before, after, ip: requestIp(req) });
  return NextResponse.json(after);
}
