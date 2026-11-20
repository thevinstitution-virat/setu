import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { cartRetailer } from "@/lib/cart-api";
import { automationSettings } from "@/lib/automation-settings";
import { readOrder } from "@/lib/order-intake";
import { MAX_ORDER_TEXT } from "@/lib/order-text";

/**
 * A1: read a typed, pasted or spoken order for one shop. Body { text,
 * retailerId? } (retailerId for agents ordering for a shop). Returns the
 * lines to check: nothing is added to a cart or ordered here.
 */
export async function POST(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) as { text?: unknown; retailerId?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Type or speak the order first" }, { status: 400 });
  if (text.length > MAX_ORDER_TEXT) return NextResponse.json({ error: `Keep it under ${MAX_ORDER_TEXT} letters (split a long order in two)` }, { status: 400 });

  const who = await cartRetailer(db, session, body?.retailerId, "view");
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const t = await db.tenant.findUnique({ where: { id: tenant.id }, select: { settings: true } });
  if (!automationSettings(t?.settings).orderText.on) return NextResponse.json({ error: "Ordering by text is turned off (Settings → Automation)" }, { status: 403 });

  const r = await readOrder({ tenantId: tenant.id, actorId: session.userId, retailerId: who.retailerId, text });
  return NextResponse.json({ lines: r.lines, source: r.source, credits: r.credits, note: r.note });
}
