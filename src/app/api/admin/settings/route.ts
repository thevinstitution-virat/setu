import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { asPlatform } from "@/lib/db";
import { moneySettings, parseMoneySettings } from "@/lib/money-settings";
import { cartSettings, parseCartSettings } from "@/lib/cart-settings";
import { invoiceSettings, parseInvoiceSettings } from "@/lib/invoice-settings";
import { deliverySettings, parseDeliverySettings } from "@/lib/delivery-settings";
import { isStateCode, normaliseGstin, validGstin } from "@/lib/gst";
import { invalidateTenantCache } from "@/lib/tenant";

const BUSINESS = { name: true, legalName: true, gstin: true, stateCode: true, address: true, phone: true } as const;

/**
 * Business settings: money rules (settings.money), cart rules (settings.cart),
 * invoice / GST rules (settings.invoice), delivery rules (settings.delivery) and the business's legal identity
 * (Tenant columns: legal name, GSTIN, state, address, phone).
 */
export async function GET() {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { settings: true, ...BUSINESS } }));
  const { settings, ...business } = t;
  return NextResponse.json({ money: moneySettings(settings), cart: cartSettings(settings), invoice: invoiceSettings(settings), delivery: deliverySettings(settings), business });
}

const SECTIONS = {
  money: { read: moneySettings, parse: (i: Record<string, unknown>) => parseMoneySettings(i) },
  cart: { read: cartSettings, parse: (i: Record<string, unknown>) => parseCartSettings(i) },
  invoice: { read: invoiceSettings, parse: (i: Record<string, unknown>, s: unknown) => parseInvoiceSettings(i, invoiceSettings(s)) },
  delivery: { read: deliverySettings, parse: (i: Record<string, unknown>) => parseDeliverySettings(i) },
} as const;

function parseBusiness(b: Record<string, unknown>) {
  const out: { legalName?: string | null; gstin?: string | null; stateCode?: string | null; address?: string | null; phone?: string | null } = {};
  if ("legalName" in b) out.legalName = String(b.legalName ?? "").trim().slice(0, 100) || null;
  if ("gstin" in b) {
    const g = normaliseGstin(b.gstin);
    if (g && !validGstin(g)) return "That GSTIN is not valid (check the 15 characters)";
    out.gstin = g || null;
  }
  if ("stateCode" in b) {
    if (b.stateCode !== null && !isStateCode(b.stateCode)) return "Choose a state";
    out.stateCode = (b.stateCode as string | null) ?? null;
  }
  if ("address" in b) out.address = String(b.address ?? "").trim().slice(0, 200) || null;
  if ("phone" in b) {
    const p = String(b.phone ?? "").replace(/\D/g, "");
    if (p && !/^\d{10,12}$/.test(p)) return "Phone must be 10 to 12 digits";
    out.phone = p || null;
  }
  const gstin = out.gstin ?? undefined;
  const state = out.stateCode ?? undefined;
  if (gstin && state && gstin.slice(0, 2) !== state) return "The GSTIN's first two digits must match the state";
  return out;
}

/** Body: { money?, cart?, invoice?, delivery?, business? } — only the fields sent change. */
export async function PATCH(req: Request) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  const keys = (Object.keys(SECTIONS) as (keyof typeof SECTIONS)[]).filter((k) => body?.[k] && typeof body[k] === "object");
  const hasBusiness = body?.business && typeof body.business === "object";
  if (!keys.length && !hasBusiness) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  const business = hasBusiness ? parseBusiness(body.business) : null;
  if (typeof business === "string") return NextResponse.json({ error: business }, { status: 400 });

  // Tenant is a platform table (no RLS row filter), so update by id under the platform role.
  const result = await asPlatform(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true, ...BUSINESS } });
    const settings = (t.settings ?? {}) as Record<string, unknown>;
    const before: Record<string, unknown> = {};
    const next: Record<string, unknown> = { ...settings };
    for (const k of keys) {
      const patch = SECTIONS[k].parse(body[k], settings);
      if (typeof patch === "string") return { error: patch };
      before[k] = SECTIONS[k].read(settings);
      next[k] = { ...(before[k] as object), ...patch };
    }
    if (business) {
      const merged = { gstin: t.gstin, stateCode: t.stateCode, ...business };
      if (merged.gstin && merged.stateCode && merged.gstin.slice(0, 2) !== merged.stateCode) return { error: "The GSTIN's first two digits must match the state" };
      before.business = { legalName: t.legalName, gstin: t.gstin, stateCode: t.stateCode, address: t.address, phone: t.phone };
    }
    await tx.tenant.update({ where: { id: tenant.id }, data: { settings: next as object, ...(business ?? {}) } });
    const after: Record<string, unknown> = Object.fromEntries(keys.map((k) => [k, next[k]]));
    if (business) after.business = business;
    return { before, after };
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  invalidateTenantCache(tenant.id);
  const sections = [...keys, ...(business ? ["business"] : [])];
  await audit(db, { actorId: session.userId, action: `settings.${sections.join("+")}`, entity: "Tenant", entityId: tenant.id, before: result.before, after: result.after, ip: requestIp(req) });
  return NextResponse.json(result.after);
}
