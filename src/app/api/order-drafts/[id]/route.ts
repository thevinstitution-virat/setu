import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { cartRetailer } from "@/lib/cart-api";
import { openDraft } from "@/lib/order-drafts";

/**
 * A WhatsApp order draft, for the shop's review sheet (?retailerId= for an
 * agent or the office). Only drafts of that shop are found.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const { id } = await params;
  const who = await cartRetailer(db, session, new URL(req.url).searchParams.get("retailerId"), "view");
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const draft = await withTenantTx(tenant.id, (tx) => openDraft(tx, who.retailerId, id));
  if (!draft) return NextResponse.json({ error: "Order draft not found" }, { status: 404 });
  return NextResponse.json({ draft });
}
