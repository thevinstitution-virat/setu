import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { mayServeRetailer } from "@/lib/cart-api";
import { readShelf } from "@/lib/photo-checks";

/**
 * A10: read a shelf photo just taken. Body: { retailerId, photoKey } →
 * { read: { ours, others, empty, seen, note } } or { read: null, message }
 * (no AI, or it couldn't read it: the agent types the counts in).
 */
export async function POST(req: Request) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const b = (await req.json().catch(() => null)) as { retailerId?: unknown; photoKey?: unknown } | null;
  if (typeof b?.retailerId !== "string" || typeof b.photoKey !== "string") return NextResponse.json({ error: "Take a photo of the shelf first" }, { status: 400 });
  const shop = await auth.db.retailerProfile.findUnique({ where: { id: b.retailerId }, select: { salesAgentId: true } });
  if (!shop || !(await mayServeRetailer(auth.db, auth.session, shop.salesAgentId))) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const r = await readShelf(auth.tenant.id, { actorId: auth.session.userId, retailerId: b.retailerId, photoKey: b.photoKey });
  return NextResponse.json(r.ok ? { read: r.read } : { read: null, message: r.message });
}
