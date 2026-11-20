import Link from "next/link";
import { InvoicePanel } from "@/components/invoice/InvoiceView";

export default async function RetailerInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="space-y-4">
      <Link href="/retailer/invoices" className="inline-block text-sm font-semibold text-[var(--kesar-text)]">
        ← My invoices
      </Link>
      <InvoicePanel id={id} />
    </div>
  );
}
