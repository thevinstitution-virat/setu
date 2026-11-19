import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { STATUS_TEXT } from "@/lib/tickets";
import { isTicketCategory } from "@/lib/engage-settings";
import HelpDesk from "./HelpDesk";

/**
 * My complaints. ?new=1 opens "New complaint" straight away; &order=<id> and
 * &category=<key> fill it in (from an order's "Report a problem").
 */
export default async function RetailerHelp({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; order?: string; category?: string }>;
}) {
  const sp = await searchParams;
  const db = await getDb();
  const session = await getSession();
  const profile = await db.retailerProfile.findUnique({ where: { userId: session!.userId }, select: { id: true } });
  const orders = profile
    ? await db.order.findMany({
        where: { retailerId: profile.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, orderNumber: true, totalAmount: true, createdAt: true },
      })
    : [];

  return (
    <HelpDesk
      statusText={STATUS_TEXT}
      orders={orders.map((o) => ({ ...o, createdAt: o.createdAt.toISOString() }))}
      openNew={sp.new === "1"}
      initialOrderId={typeof sp.order === "string" ? sp.order : null}
      initialCategory={isTicketCategory(sp.category) ? sp.category : null}
    />
  );
}
