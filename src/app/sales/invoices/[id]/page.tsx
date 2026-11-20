import Link from "next/link";
import { getSession } from "@/lib/auth";
import { getDb } from "@/lib/tenant";
import { InvoicePanel } from "@/components/invoice/InvoiceView";

export default async function SalesInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  const session = await getSession();
  // Back to the retailer's screen when the agent may see it (the panel itself checks access via the API).
  const [agent, inv] = await Promise.all([
    db.salesAgentProfile.findUnique({ where: { userId: session!.userId }, select: { id: true } }),
    db.invoice.findUnique({ where: { id }, select: { retailer: { select: { id: true, outletName: true, salesAgentId: true } } } }),
  ]);
  const back = agent && inv && inv.retailer.salesAgentId === agent.id ? inv.retailer : null;

  return (
    <div className="space-y-4">
      <Link href={back ? `/sales/retailers/${back.id}` : "/sales"} className="inline-block text-sm font-semibold text-[var(--kesar-text)]">
        ← {back ? back.outletName : "Back"}
      </Link>
      <InvoicePanel id={id} />
    </div>
  );
}
