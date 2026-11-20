import { getSession } from "@/lib/auth";
import { getDb, requireTenant } from "@/lib/tenant";
import { deliverySettings } from "@/lib/delivery-settings";
import DeliverOrder from "./DeliverOrder";
import type { DeliveryInvoice } from "./DeliveryInvoiceCard";

/**
 * Delivery screen. The order itself loads on the client (/api/orders/[id]);
 * the invoice issued at dispatch (or at delivery) and the stop's trip are
 * read here, only for the agent the order is assigned to.
 */
export default async function DeliverOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [db, session, tenant] = await Promise.all([getDb(), getSession(), requireTenant()]);
  const [agent, delivery] = await Promise.all([
    db.deliveryAgentProfile.findUnique({ where: { userId: session!.userId }, select: { id: true } }),
    db.delivery.findUnique({ where: { orderId: id }, select: { deliveryAgentId: true, trip: { select: { status: true } } } }),
  ]);
  const mine = !!agent && delivery?.deliveryAgentId === agent.id;
  const rows = mine
    ? await db.invoice.findMany({
        where: { orderId: id },
        orderBy: { date: "asc" },
        select: { id: true, type: true, number: true, total: true, ewbNo: true, ewbVehicle: true, ewbValidUntil: true },
      })
    : [];
  const invoices: DeliveryInvoice[] = rows.map((r) => ({ ...r, ewbValidUntil: r.ewbValidUntil?.toISOString() ?? null }));
  const { photoRequired } = deliverySettings(tenant.settings);

  return (
    <DeliverOrder
      id={id}
      invoices={invoices}
      photoRequired={photoRequired}
      tripStatus={mine ? (delivery?.trip?.status ?? null) : null}
    />
  );
}
