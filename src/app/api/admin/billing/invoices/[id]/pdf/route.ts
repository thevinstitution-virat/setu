import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { renderPlatformInvoicePdf } from "@/lib/platform-invoice-pdf";

/** One of our invoices to this business, as a PDF. */
export async function GET(_req: Request, ctx: RouteContext<"/api/admin/billing/invoices/[id]/pdf">) {
  const auth = await guard("settings.manage");
  if (!auth.ok) return auth.res;
  const { id } = await ctx.params;
  const inv = await auth.db.platformInvoice.findUnique({ where: { id } });
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  const bytes = await renderPlatformInvoicePdf(inv);
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${inv.number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"` },
  });
}
