import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { invalidateTenantCache } from "@/lib/tenant";
import { entitlements } from "@/lib/plans";
import { checkColours, DEFAULT_COLOURS, parseBrand, themeVars, validateBrandInput, type Brand } from "@/lib/branding";
import type { Prisma } from "@/generated/prisma/client";

const view = (brand: Brand, whiteLabel: boolean, businessName: string) => ({
  brand,
  businessName,
  whiteLabel,
  defaults: DEFAULT_COLOURS,
  logoUrl: brand.logoKey ? `/api/files/${brand.logoKey}` : null,
  iconUrl: brand.iconKey ? `/api/files/${brand.iconKey}` : null,
  theme: themeVars(brand),
});

/** The business's look: app name, sign-in line, logo, icon, colours, invoice look, sender names. */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { brand: true } }));
  return NextResponse.json(view(parseBrand(t.brand), (await entitlements(auth.tenant.id)).features.has("whiteLabel"), auth.tenant.name));
}

/**
 * Body: any of appName, shortName, tagline, logoKey, iconKey (from /api/uploads with kind
 * brand-logo / brand-icon), primary, accent, surface, invoice{accent,footer,showLogo},
 * sender{smsSenderId,whatsappName,emailFromName,replyTo}. Colours are contrast-checked.
 * ?check=1 only checks colours and returns the preview tokens (nothing saved).
 */
export async function PUT(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { session, tenant, db } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Send the changes as JSON" }, { status: 400 });

  const whiteLabel = (await entitlements(tenant.id)).features.has("whiteLabel");
  const looks = ["logoKey", "iconKey", "primary", "accent", "surface"].filter((k) => k in body && body[k] !== null && body[k] !== "");
  // Only a real look change needs white-label (null / false / "" just clear it).
  const inv = (body.invoice && typeof body.invoice === "object" ? body.invoice : {}) as Record<string, unknown>;
  const invoiceLook = (inv.accent !== undefined && inv.accent !== null && inv.accent !== "") || inv.showLogo === true;
  if (!whiteLabel && (looks.length || invoiceLook)) {
    return NextResponse.json({ error: "Your own logo and colours are in plans with white-label. See Billing.", code: "upgrade", feature: "whiteLabel" }, { status: 402 });
  }

  const before = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { brand: true } }));
  const current = parseBrand(before.brand);
  const keyOk = (key: string) => (key.startsWith(`t/${tenant.id}/brand-logo/`) || key.startsWith(`t/${tenant.id}/brand-icon/`)) && !key.includes("..");
  const r = validateBrandInput(current, body, keyOk);

  if (new URL(req.url).searchParams.get("check") === "1") {
    const colours = { ...DEFAULT_COLOURS, ...(r.ok ? { primary: r.brand.primary ?? DEFAULT_COLOURS.primary, accent: r.brand.accent ?? DEFAULT_COLOURS.accent, surface: r.brand.surface ?? DEFAULT_COLOURS.surface } : {}) };
    return NextResponse.json({ ok: r.ok, errors: r.ok ? checkColours(colours) : r.errors, theme: r.ok ? themeVars(r.brand) : {} });
  }
  if (!r.ok) return NextResponse.json({ error: r.errors[0].message, errors: r.errors }, { status: 400 });

  await asPlatform((tx) => tx.tenant.update({ where: { id: tenant.id }, data: { brand: r.brand as unknown as Prisma.InputJsonValue } }));
  invalidateTenantCache(tenant.id);
  await audit(db, { actorId: session.userId, action: "brand.update", entity: "Tenant", entityId: tenant.id, before: current, after: r.brand, ip: requestIp(req) });
  return NextResponse.json(view(r.brand, whiteLabel, tenant.name));
}
