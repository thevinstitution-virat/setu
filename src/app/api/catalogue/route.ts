import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";
import { catalogueFor, inWindow, retailerPricingCtx, schemesFor, targets } from "@/lib/pricing";
import { cartSettings, deliveryDays } from "@/lib/cart-settings";
import { cartRetailer } from "@/lib/cart-api";

/**
 * The storefront for one retailer: products they can see at their rates,
 * categories, brands, banners, schemes for them, "buy again" and cart rules.
 * ?retailerId= for sales agents (their retailers) and office staff ("view as").
 */
export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const who = await cartRetailer(db, session, new URL(req.url).searchParams.get("retailerId"), "view");
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });

  const now = new Date();
  const data = await withTenantTx(tenant.id, async (tx) => {
    const r = (await retailerPricingCtx(tx, who.retailerId))!;
    const [retailer, products, { offers }, cats, brands, banners, recent, t] = await Promise.all([
      tx.retailerProfile.findUniqueOrThrow({
        where: { id: r.id },
        select: { id: true, outletName: true, area: { select: { name: true } }, priceList: { select: { name: true } } },
      }),
      catalogueFor(tx, r),
      schemesFor(tx, r, now),
      tx.category.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true, parentId: true, imageKey: true } }),
      tx.brand.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { name: "asc" }], select: { id: true, name: true, logoKey: true } }),
      tx.banner.findMany({ where: { active: true }, orderBy: [{ sort: "asc" }, { createdAt: "desc" }] }),
      tx.orderItem.findMany({
        where: { order: { retailerId: r.id, status: { not: "CANCELLED" } }, freeSchemeId: null },
        orderBy: { order: { createdAt: "desc" } },
        take: 200,
        select: { productId: true },
      }),
      tx.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } }),
    ]);

    const visible = new Set(products.map((p) => p.id));
    const freq = new Map<string, number>();
    for (const i of recent) if (visible.has(i.productId)) freq.set(i.productId, (freq.get(i.productId) ?? 0) + 1);
    const buyAgain = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);

    // Only categories / brands that have something to show (and the parents of those categories).
    const usedCats = new Set(products.flatMap((p) => p.categoryPath));
    const usedBrands = new Set(products.map((p) => p.brand?.id).filter(Boolean));
    const cart = cartSettings(t.settings);
    return {
      retailer: { id: retailer.id, outletName: retailer.outletName, area: retailer.area.name, priceList: retailer.priceList?.name ?? null },
      products,
      categories: cats.filter((c) => usedCats.has(c.id)),
      brands: brands.filter((b) => usedBrands.has(b.id)),
      banners: banners
        .filter((b) => inWindow(b, now) && targets(b, r))
        .map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, imageKey: b.imageKey, linkType: b.linkType, linkId: b.linkId })),
      offers,
      buyAgain,
      cart: {
        minOrderValue: cart.minOrderValue,
        deliveryCharge: cart.deliveryCharge,
        freeDeliveryAbove: cart.freeDeliveryAbove,
        allowDateChoice: cart.allowDateChoice,
        cutoffTime: cart.cutoffTime,
        deliveryDates: deliveryDays(cart, now),
      },
    };
  });
  return NextResponse.json(data);
}
