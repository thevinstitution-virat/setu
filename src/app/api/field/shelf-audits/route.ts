import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { mayServeRetailer } from "@/lib/cart-api";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { kickPhotos } from "@/lib/jobs";
import { automationSettings } from "@/lib/automation-settings";
import { recentShelfAudits, saveShelfAudit, type ShelfInput } from "@/lib/shelf";

/** A10: GET ?retailerId= → { on, audits } (the last few shelf audits at a shop the agent serves). */
export async function GET(req: Request) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const retailerId = new URL(req.url).searchParams.get("retailerId") ?? "";
  const shop = await auth.db.retailerProfile.findUnique({ where: { id: retailerId }, select: { salesAgentId: true } });
  if (!shop || !(await mayServeRetailer(auth.db, auth.session, shop.salesAgentId))) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const t = await auth.db.tenant.findUnique({ where: { id: auth.tenant.id }, select: { settings: true } });
  return withMoney(auth.tenant.id, auth.session.userId, async (ctx) =>
    NextResponse.json({ on: automationSettings(t?.settings).shelf.on, audits: await recentShelfAudits(ctx.tx, retailerId) })
  );
}

/** A10: save a shelf audit. Body: { retailerId, visitId?, photoKey, ours, others, empty, seen?: productId[], read?, note? } */
export async function POST(req: Request) {
  const auth = await guard("field.work");
  if (!auth.ok) return auth.res;
  const b = (await req.json().catch(() => null)) as ShelfInput | null;
  if (!b || typeof b.retailerId !== "string" || typeof b.photoKey !== "string") return NextResponse.json({ error: "Take a photo of the shelf first" }, { status: 400 });
  const shop = await auth.db.retailerProfile.findUnique({ where: { id: b.retailerId }, select: { salesAgentId: true } });
  if (!shop || !(await mayServeRetailer(auth.db, auth.session, shop.salesAgentId))) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const t = await auth.db.tenant.findUnique({ where: { id: auth.tenant.id }, select: { settings: true } });
  if (!automationSettings(t?.settings).shelf.on) return NextResponse.json({ error: "Shelf audits are turned off" }, { status: 403 });
  try {
    const audit = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => saveShelfAudit(ctx.tx, auth.tenant.id, auth.session.userId, b));
    await kickPhotos(auth.tenant.id);
    return NextResponse.json({ audit: { id: audit.id, source: audit.source } }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
