import { emit } from "@/lib/jobs";

/** After a document is issued: queue its e-invoice when one is needed. */
export async function queueEInvoice(tenantId: string, doc: { id: string; einvStatus: string }) {
  if (doc.einvStatus !== "PENDING") return;
  await emit("einvoice.generate", { tenantId, invoiceId: doc.id }, { retryLimit: 3, retryDelay: 60 });
}
