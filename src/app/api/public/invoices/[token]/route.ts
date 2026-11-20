import { NextResponse } from "next/server";
import { getTenant } from "@/lib/tenant";
import { tenantDb } from "@/lib/db";
import { loadInvoiceDoc } from "@/lib/invoice";
import { renderInvoicePdf } from "@/lib/invoice-pdf";
import { openShareToken, pdfHeaders, pdfOptions } from "@/lib/invoice-api";

/** Shared link (no sign-in): the PDF of one document, if the token is genuine for this business. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: "Unknown business address" }, { status: 404 });
  const { token } = await params;
  const db = tenantDb(tenant.id);
  const id = await openShareToken(db, tenant.id, token);
  if (!id) return NextResponse.json({ error: "This link is not valid or has expired" }, { status: 404 });
  const doc = await loadInvoiceDoc(db as never, id);
  if (!doc) return NextResponse.json({ error: "This link is not valid" }, { status: 404 });
  const bytes = await renderInvoicePdf(doc, await pdfOptions(db, tenant.id));
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(Buffer.from(bytes), { headers: { ...pdfHeaders(doc.number, download), "X-Robots-Tag": "noindex" } });
}
