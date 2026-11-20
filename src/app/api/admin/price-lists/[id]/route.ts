import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { bad, optText, ownIds, paise, text } from "@/lib/catalogue-api";
import { marginPct } from "@/lib/pricing";

/** The list with every active product: default rate, this list's rate (or null), margin. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { id } = await params;
  const list = await auth.db.priceList.findUnique({ where: { id }, include: { items: true, _count: { select: { retailers: true } } } });
  if (!list) return bad("Not found", 404);
  const products = await auth.db.product.findMany({
    where: { active: true },
    orderBy: [{ category: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, sku: true, unit: true, price: true, mrp: true, gstRate: true, category: { select: { name: true } }, brand: { select: { name: true } } },
  });
  const rate = new Map(list.items.map((i) => [i.productId, i.price]));
  return NextResponse.json({
    list: { id: list.id, name: list.name, description: list.description, active: list.active, retailers: list._count.retailers },
    products: products.map((p) => {
      const listPrice = rate.get(p.id) ?? null;
      return { ...p, listPrice, margin: marginPct(listPrice ?? p.price, p.gstRate, p.mrp) };
    }),
  });
}

/** { name?, description?, active?, items?: [{ productId, price | null }] } — null removes the product from the list. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await guard("pricing.manage");
  if (!auth.ok) return auth.res;
  const { db, session, tenant } = auth;
  const { id } = await params;
  const before = await db.priceList.findUnique({ where: { id } });
  if (!before) return bad("Not found", 404);
  const b = (await req.json().catch(() => null)) ?? {};
  const data: Record<string, unknown> = {};
  if ("name" in b) {
    const name = text(b.name, 60);
    if (!name) return bad("Name is required");
    if (await db.priceList.findFirst({ where: { id: { not: id }, name: { equals: name, mode: "insensitive" } } })) return bad("That price list already exists", 409);
    data.name = name;
  }
  if ("description" in b) data.description = optText(b.description, 200);
  if ("active" in b) data.active = b.active === true;

  const items: { productId: string; price: number | null }[] = Array.isArray(b.items) ? b.items.slice(0, 5000) : [];
  if (items.some((i) => typeof i?.productId !== "string" || (i.price !== null && !paise(i.price)))) return bad("Rates must be whole paise");
  if (!(await ownIds(db, "product", items.map((i) => i.productId)))) return bad("Unknown product");

  const result = await withTenantTx(tenant.id, async (tx) => {
    if (Object.keys(data).length) await tx.priceList.update({ where: { id }, data });
    let set = 0, removed = 0;
    for (const i of items) {
      if (i.price === null) {
        removed += (await tx.priceListItem.deleteMany({ where: { priceListId: id, productId: i.productId } })).count;
      } else {
        await tx.priceListItem.upsert({
          where: { priceListId_productId: { priceListId: id, productId: i.productId } },
          create: { priceListId: id, productId: i.productId, price: i.price },
          update: { price: i.price },
        });
        set++;
      }
    }
    return { set, removed };
  }, { timeout: 60_000 });
  await audit(db, { actorId: session.userId, action: "pricelist.update", entity: "PriceList", entityId: id, before, after: { ...data, ...result }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, ...result });
}
