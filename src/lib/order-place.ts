import { MoneyError, lockRetailer, onOrderPlaced, type Ctx } from "@/lib/ledger";
import { nextOrderNumber } from "@/lib/orders";
import { quoteCart, retailerPricingCtx, type CartItemInput, type Quote } from "@/lib/pricing";
import type { Tx } from "@/lib/db";
import { invoiceSettings } from "@/lib/invoice-settings";

/**
 * Place an order from a cart (inside withMoney). Prices, schemes, delivery
 * charge and day are worked out here by quoteCart — the same code the cart
 * preview uses — so the order matches what the retailer saw. Scheme budgets
 * are spent atomically; if a budget ran out since the preview, the order is
 * refused (409) and the retailer sees the new cart.
 */
export async function placeOrder(
  ctx: Ctx,
  p: {
    retailerId: string;
    placedById: string;
    items: CartItemInput[];
    coupon?: string | null;
    deliveryDate?: string | null;
    notes?: string | null;
    visitId?: string | null;
    now?: Date;
    /** Spot sales check the van instead of warehouse availability. */
    skipStockCheck?: boolean;
  }
) {
  const { tx } = ctx;
  await lockRetailer(ctx, p.retailerId);
  const r = await retailerPricingCtx(tx, p.retailerId);
  if (!r) throw new MoneyError("Retailer not found", 404);
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  const quote = await quoteCart(tx, tenant.settings, r, { items: p.items, coupon: p.coupon, deliveryDate: p.deliveryDate, skipStockCheck: p.skipStockCheck }, p.now);
  if (quote.problems.length) throw new MoneyError(quote.problems[0], 400);
  const salesmanId = await defaultSalesman(tx, p.retailerId, p.placedById);

  const created = await tx.order.create({
    data: {
      orderNumber: await nextOrderNumber(tx, ctx.tenantId),
      retailerId: p.retailerId,
      placedById: p.placedById,
      salesmanId,
      taxInclusive: invoiceSettings(tenant.settings).ratesIncludeGst,
      grossAmount: quote.grossAmount,
      discountAmount: quote.discountAmount,
      deliveryCharge: quote.deliveryCharge,
      deliveryGstRate: quote.deliveryCharge > 0 ? quote.deliveryGstRate : 0,
      subtotal: quote.subtotal,
      gstAmount: quote.gstAmount,
      roundTotal: invoiceSettings(tenant.settings).roundOff === "rupee",
      roundOff: quote.roundOff,
      totalAmount: quote.totalAmount,
      couponCode: quote.coupon?.valid ? quote.coupon.code : null,
      deliveryDate: quote.deliveryDate ? new Date(`${quote.deliveryDate}T00:00:00Z`) : null,
      priceListId: quote.priceListId,
      notes: p.notes?.slice(0, 500) || null,
      items: {
        create: [
          ...quote.lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            price: l.price,
            gstRate: l.gstRate,
            // As charged against the rate (includes GST when the rates do); the invoice works GST out from it.
            discount: l.itemDiscount,
            mrp: l.mrp,
            cases: l.cases,
            caseSize: l.cases ? l.caseSize : null,
          })),
          ...quote.free.map((f) => ({
            productId: f.productId,
            quantity: f.quantity,
            price: 0,
            gstRate: f.gstRate,
            mrp: f.mrp,
            freeSchemeId: f.schemeId,
          })),
        ],
      },
      statusEvents: { create: { status: "PLACED", actorId: p.placedById } },
    },
    include: { items: true },
  });

  for (const a of quote.applied) {
    const n = await tx.$executeRaw`
      UPDATE "Scheme" SET "spent" = "spent" + ${a.value}, "updatedAt" = now()
      WHERE "id" = ${a.schemeId} AND "active" AND ("budget" IS NULL OR "spent" + ${a.value} <= "budget")`;
    if (n !== 1) throw new MoneyError(`The scheme "${a.name}" has just run out. Check your cart again.`, 409);
    await tx.schemeRedemption.create({
      data: { schemeId: a.schemeId, orderId: created.id, retailerId: p.retailerId, value: a.value, freeQty: a.freeQty },
    });
  }

  if (p.visitId) {
    // Only this shop's visit, made by the person placing the order.
    await tx.visit.updateMany({
      where: { id: p.visitId, orderId: null, retailerId: p.retailerId, salesAgent: { userId: p.placedById } },
      data: { orderId: created.id },
    });
  }
  const credit = await onOrderPlaced(ctx, created);
  return { order: { ...created, creditHold: credit.hold, creditHoldReason: credit.reason }, quote };
}

/**
 * Who gets the order on their book: the sales agent who placed it, otherwise
 * the shop's own sales agent (shop, office or driver orders). null = none.
 */
export async function defaultSalesman(tx: Tx, retailerId: string, placedById: string | null) {
  if (placedById) {
    const placer = await tx.user.findUnique({ where: { id: placedById }, select: { role: true } });
    if (placer?.role === "SALES_AGENT") return placedById;
  }
  const shop = await tx.retailerProfile.findUnique({ where: { id: retailerId }, select: { salesAgent: { select: { userId: true } } } });
  return shop?.salesAgent?.userId ?? null;
}

/** Order cancelled: give the scheme budget back and free the retailer's use. */
export async function releaseRedemptions(tx: Tx, orderId: string) {
  const rows = await tx.schemeRedemption.findMany({ where: { orderId, reversed: false } });
  for (const r of rows) {
    await tx.schemeRedemption.update({ where: { id: r.id }, data: { reversed: true } });
    await tx.$executeRaw`UPDATE "Scheme" SET "spent" = GREATEST(0, "spent" - ${r.value}), "updatedAt" = now() WHERE "id" = ${r.schemeId}`;
  }
}

export type { Quote };
