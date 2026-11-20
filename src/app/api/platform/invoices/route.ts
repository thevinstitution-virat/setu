import { NextResponse } from "next/server";
import { asPlatform } from "@/lib/db";
import { platformGuard } from "@/lib/platform-auth";
import type { PlatformInvoiceStatus, Prisma } from "@/generated/prisma/client";

/** Our invoices to businesses. ?status=ISSUED|PAID|VOID &overdue=1 &tenantId= */
export async function GET(req: Request) {
  const g = await platformGuard();
  if (!g.ok) return g.res;
  const sp = new URL(req.url).searchParams;
  const where: Prisma.PlatformInvoiceWhereInput = {};
  const st = sp.get("status") as PlatformInvoiceStatus | null;
  if (st && ["ISSUED", "PAID", "VOID"].includes(st)) where.status = st;
  if (sp.get("overdue") === "1") Object.assign(where, { status: "ISSUED", dueAt: { lte: new Date() } });
  if (sp.get("tenantId")) where.tenantId = sp.get("tenantId")!;
  const rows = await asPlatform((tx) =>
    tx.platformInvoice.findMany({ where, orderBy: { issuedAt: "desc" }, take: 200, include: { tenant: { select: { name: true, slug: true } } } })
  );
  const totals = await asPlatform((tx) => tx.platformInvoice.groupBy({ by: ["status"], _sum: { total: true }, _count: true }));
  return NextResponse.json({ invoices: rows, totals });
}
