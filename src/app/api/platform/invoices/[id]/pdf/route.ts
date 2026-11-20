import { NextResponse } from "next/server";
import { asPlatform } from "@/lib/db";
import { platformGuard } from "@/lib/platform-auth";
import { renderPlatformInvoicePdf } from "@/lib/platform-invoice-pdf";

export async function GET(_req: Request, ctx: RouteContext<"/api/platform/invoices/[id]/pdf">) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const inv = await asPlatform((tx) => tx.platformInvoice.findUnique({ where: { id } }));
  if (!inv) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(await renderPlatformInvoicePdf(inv)), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${inv.number.replace(/[^A-Za-z0-9-]/g, "_")}.pdf"` },
  });
}
