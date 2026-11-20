import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { mayServeRetailer } from "@/lib/cart-api";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const { session, db } = auth;
  const { id } = await params;
  const retailer = await db.retailerProfile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, phone: true, active: true } },
      area: true,
      orders: { orderBy: { createdAt: "desc" }, take: 5, include: { items: true } },
      visits: { orderBy: { checkInAt: "desc" }, take: 5 },
    },
  });

  if (!retailer || !(await mayServeRetailer(db, session, retailer.salesAgentId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Products come from /api/catalogue?retailerId= (this retailer's own rates and visibility).
  return NextResponse.json({ retailer });
}
