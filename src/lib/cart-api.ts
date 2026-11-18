import type { SessionPayload } from "@/lib/auth";
import type { TenantDb } from "@/lib/db";
import { can } from "@/lib/permissions";

/**
 * Which retailer a cart / catalogue request is for.
 * - Retailer: always themselves.
 * - Sales agent: a retailer on their book.
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
  if (session.role === "SALES_AGENT") {
    const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId }, select: { id: true } });
    if (!agent || retailer.salesAgentId !== agent.id) return { error: "Retailer not assigned to you", status: 403 };
    return { retailerId: retailer.id };
  }
  if (purpose === "view" && can(session.role, "orders.manage")) return { retailerId: retailer.id };
  return { error: "Not permitted to place orders", status: 403 };
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
