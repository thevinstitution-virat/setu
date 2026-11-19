import type { SessionPayload } from "@/lib/auth";
import type { TenantDb } from "@/lib/db";
import { can } from "@/lib/permissions";
import { fieldSettings } from "@/lib/field-settings";

/**
 * Which retailer a cart / catalogue request is for.
 * - Retailer: always themselves.
 * - Sales agent: a retailer on their book, or any retailer when off-beat
 *   ordering is on (Settings -> Field team) or they hold field.offbeat.
 * - Supervisor (field.offbeat): any retailer.
 * - Office staff (orders.manage): any retailer, to view prices as that
 *   retailer sees them ("view as") — placing orders stays with retailers and agents.
 */
export async function cartRetailer(
  db: TenantDb,
  session: SessionPayload,
  retailerId: unknown,
  purpose: "view" | "order"
): Promise<{ retailerId: string } | { error: string; status: number }> {
  if (session.role === "RETAILER") {
    const me = await db.retailerProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    return me ? { retailerId: me.id } : { error: "Retailer profile not found", status: 404 };
  }
  if (typeof retailerId !== "string" || !retailerId) return { error: "Choose a retailer", status: 400 };
  const retailer = await db.retailerProfile.findUnique({ where: { id: retailerId }, select: { id: true, salesAgentId: true } });
  if (!retailer) return { error: "Retailer not found", status: 404 };
  if (session.role === "SALES_AGENT" || session.role === "SUPERVISOR") {
    if (await mayServeRetailer(db, session, retailer.salesAgentId)) return { retailerId: retailer.id };
    return { error: "Retailer not assigned to you", status: 403 };
  }
  if (purpose === "view" && can(session.role, "orders.manage")) return { retailerId: retailer.id };
  return { error: "Not permitted to place orders", status: 403 };
}

/** May this field person see and order for a shop (own book, or off-beat allowed)? */
export async function mayServeRetailer(db: TenantDb, session: SessionPayload, retailerAgentId: string | null): Promise<boolean> {
  if (can(session.role, "field.offbeat")) return true;
  const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
  if (!agent) return false;
  if (retailerAgentId === agent.id) return true;
  const t = await db.tenant.findUnique({ where: { id: session.tenantId }, select: { settings: true } });
  return fieldSettings(t?.settings).offBeat;
}

export function parseCartBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(b.items) ? b.items.slice(0, 300) : [];
  const items = raw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === "object" && typeof (i as Record<string, unknown>).productId === "string")
    .map((i) => ({
      productId: i.productId as string,
      ...(i.cases !== undefined && i.cases !== null ? { cases: Number(i.cases) } : { quantity: Number(i.quantity) }),
    }));
  return {
    items,
    coupon: typeof b.coupon === "string" ? b.coupon : null,
    deliveryDate: typeof b.deliveryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.deliveryDate) ? b.deliveryDate : null,
    notes: typeof b.notes === "string" ? b.notes.slice(0, 500) : null,
    retailerId: b.retailerId,
    visitId: typeof b.visitId === "string" ? b.visitId : null,
  };
}
