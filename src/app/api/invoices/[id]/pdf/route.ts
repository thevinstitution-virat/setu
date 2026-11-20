import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { loadInvoiceDoc } from "@/lib/invoice";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { canSeeInvoice, pdfHeaders, pdfOptions } from "@/lib/invoice-api";

/** The document as a PDF (?download=1 to save instead of open). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const doc = await loadInvoiceDoc(db as never, id);
  if (!doc || !(await canSeeInvoice(db, session, doc))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const bytes = await renderInvoicePdf(doc, await pdfOptions(db, tenant.id));
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(Buffer.from(bytes), { headers: pdfHeaders(doc.number, download) });
}
