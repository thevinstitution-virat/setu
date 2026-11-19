import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import DeliverOrder from "./DeliverOrder";
import type { DeliveryInvoice } from "./DeliveryInvoiceCard";

/**
 * Delivery screen. The order itself loads on the client (/api/orders/[id]);
 * the invoice issued at dispatch (or at delivery) is read here, only for the
 * agent the order is assigned to.
 */
export default async function DeliverOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const session = await getSession();
  const [agent, delivery] = await Promise.all([
    db.deliveryAgentProfile.findUnique({ where: { userId: session!.userId }, select: { id: true } }),
    db.delivery.findUnique({ where: { orderId: id }, select: { deliveryAgentId: true } }),
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

  return <DeliverOrder id={id} invoices={invoices} />;
}
