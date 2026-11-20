import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import InvoiceList, { dueByNumber } from "@/components/InvoiceList";
import RetailerDetail from "./RetailerDetail";

/** Retailer screen for the sales agent; the last 5 invoices are read here (only for the agent's own retailers). */
export default async function RetailerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const session = await getSession();
  const [agent, retailer] = await Promise.all([
    db.salesAgentProfile.findUnique({ where: { userId: session!.userId }, select: { id: true } }),
    db.retailerProfile.findUnique({ where: { id }, select: { salesAgentId: true } }),
  ]);
  const mine = !!agent && retailer?.salesAgentId === agent.id;

  let invoices: React.ReactNode = null;
  if (mine) {
    const rows = await db.invoice.findMany({
      where: { retailerId: id },
      orderBy: [{ date: "desc" }, { number: "desc" }],
      take: 5,
      select: {
        id: true,
        type: true,
        number: true,
        date: true,
        total: true,
        order: { select: { orderNumber: true } },
        original: { select: { number: true } },
      },
    });
    const due = await dueByNumber(db, rows.map((r) => r.number));
    invoices = (
      <div>
        <p className="text-sm font-semibold mb-2">Recent invoices</p>
        <InvoiceList rows={rows.map((r) => ({ ...r, due: due.get(r.number) ?? null }))} hrefBase="/sales/invoices" />
      </div>
    );
  }

  return <RetailerDetail id={id} invoices={invoices} />;
}
