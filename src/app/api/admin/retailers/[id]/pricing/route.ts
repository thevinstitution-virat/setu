import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { bad, idArray, optText, ownIds, paise } from "@/lib/catalogue-api";

/** A retailer's price list, groups and special rates. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const r = await auth.db.retailerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      outletName: true,
      priceListId: true,
      area: { select: { id: true, name: true } },
      groups: { select: { group: { select: { id: true, name: true } } } },
      prices: { select: { productId: true, price: true, note: true, updatedAt: true, product: { select: { name: true, sku: true, price: true, mrp: true, gstRate: true } } } },
    },
  });
  if (!r) return bad("Not found", 404);
  return NextResponse.json({ retailer: { ...r, groups: r.groups.map((g) => g.group) } });
}

/** { priceListId?: id | null, groupIds?: [...], prices?: [{ productId, price | null, note? }] } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const before = await db.retailerProfile.findUnique({ where: { id }, select: { id: true, priceListId: true, groups: { select: { groupId: true } } } });
  if (!before) return bad("Not found", 404);
  const b = (await req.json().catch(() => null)) ?? {};

  let priceListId: string | null | undefined;
  if ("priceListId" in b) {
    priceListId = typeof b.priceListId === "string" && b.priceListId ? b.priceListId : null;
    if (priceListId && !(await ownIds(db, "priceList", [priceListId]))) return bad("Unknown price list");
  }
  const groupIds = "groupIds" in b ? idArray(b.groupIds, 100) : undefined;
  if (groupIds === null || (groupIds && !(await ownIds(db, "group", groupIds)))) return bad("Unknown group");
  const prices: { productId: string; price: number | null; note?: string }[] = Array.isArray(b.prices) ? b.prices.slice(0, 2000) : [];
  if (prices.some((p) => typeof p?.productId !== "string" || (p.price !== null && !paise(p.price)))) return bad("Rates must be whole paise");
  if (!(await ownIds(db, "product", prices.map((p) => p.productId)))) return bad("Unknown product");

  await withTenantTx(tenant.id, async (tx) => {
    if (priceListId !== undefined) await tx.retailerProfile.update({ where: { id }, data: { priceListId } });
    if (groupIds) {
      await tx.retailerGroupMember.deleteMany({ where: { retailerId: id, groupId: { notIn: groupIds } } });
      await tx.retailerGroupMember.createMany({ data: groupIds.map((groupId) => ({ groupId, retailerId: id })), skipDuplicates: true });
    }
    for (const p of prices) {
      if (p.price === null) await tx.retailerPrice.deleteMany({ where: { retailerId: id, productId: p.productId } });
      else
        await tx.retailerPrice.upsert({
          where: { retailerId_productId: { retailerId: id, productId: p.productId } },
          create: { retailerId: id, productId: p.productId, price: p.price, note: optText(p.note, 120) },
          update: { price: p.price, note: optText(p.note, 120) },
        });
    }
  }, { timeout: 60_000 });
  await audit(db, {
    actorId: session.userId,
    action: "retailer.pricing",
    entity: "RetailerProfile",
    entityId: id,
    before: { priceListId: before.priceListId, groupIds: before.groups.map((g) => g.groupId) },
    after: { priceListId, groupIds, prices: prices.length },
    ip: requestIp(req),
  });
  return NextResponse.json({ ok: true });
}
