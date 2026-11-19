import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";
import { gatewaySettings, parseGatewaySettings, publicGateway, type GatewaySettings } from "@/lib/gateway-settings";
import { invalidateTenantCache } from "@/lib/tenant";
import { tenantUrl } from "@/lib/notify";

/**
 * Online payments (settings.gateway). Kept apart from the other settings so
 * the secrets never go back to the browser or into the audit log: screens
 * only learn whether each secret is set.
 */
async function view(tenantId: string, settings: unknown) {
  const g = gatewaySettings(settings);
  const webhookUrl = await asPlatform((tx) => tenantUrl(tx, tenantId, "/api/webhooks/razorpay"));
  return {
    ...publicGateway(g),
    webhookUrl,
    webhookEvents: ["payment_link.paid", "payment_link.partially_paid", "payment_link.expired", "payment_link.cancelled", "qr_code.credited", "qr_code.closed", "payment.captured", "settlement.processed"],
    simulatorAllowed: simulatorAllowed(),
  };
}

const simulatorAllowed = () => process.env.NODE_ENV !== "production" || process.env.ALLOW_GATEWAY_SIMULATOR === "1";

export async function GET() {
  const auth = await guard("gateway.manage");
  if (!auth.ok) return auth.res;
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true } }));
  return NextResponse.json(await view(auth.tenant.id, t.settings));
}

/** Body: { provider?, keyId?, keySecret?, webhookSecret?, acceptPartial?, retailerPay?, linkDays?, qrMinutes? }. Empty secrets keep the saved ones. */
export async function PATCH(req: Request) {
  const auth = await guard("gateway.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  const parsed = parseGatewaySettings(body);
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  if (parsed.provider === "simulator" && !simulatorAllowed()) return NextResponse.json({ error: "The practice gateway is not available here" }, { status: 400 });
  const { newKeySecret, newWebhookSecret, ...patch } = parsed;

  const result = await asPlatform(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } });
    const settings = (t.settings ?? {}) as Record<string, unknown>;
    const before = gatewaySettings(settings);
    const next: GatewaySettings = { ...before, ...patch };
    // A new key id from another account makes the old secret useless.
    if (patch.keyId !== undefined && patch.keyId !== before.keyId && !newKeySecret) next.keySecret = "";
    if (newKeySecret) next.keySecret = encryptSecret(newKeySecret);
    if (newWebhookSecret) next.webhookSecret = encryptSecret(newWebhookSecret);
    if (next.provider === "razorpay" && (!next.keyId || !next.keySecret)) return { error: "Enter the Razorpay key id and key secret" };
    await tx.tenant.update({ where: { id: tenant.id }, data: { settings: { ...settings, gateway: next } as object } });
    return { before: publicGateway(before), after: publicGateway(next), settings: { ...settings, gateway: next } };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  invalidateTenantCache(tenant.id);
  await audit(db, { actorId: session.userId, action: "settings.gateway", entity: "Tenant", entityId: tenant.id, before: result.before, after: result.after, ip: requestIp(req) });
  return NextResponse.json(await view(tenant.id, result.settings));
}
