import type { Tx } from "@/lib/db";
import type { Scheme } from "@/generated/prisma/client";
import { formatINR, gstOn, lineMoney } from "@/lib/money";
import { applySchemes, describeScheme, type AppliedScheme, type EngineLine, type EngineScheme, type SchemeParams } from "@/lib/schemes";
import { cartSettings, deliveryChargeFor, deliveryDays } from "@/lib/cart-settings";
import { invoiceSettings } from "@/lib/invoice-settings";
import { searchText } from "@/lib/translit";
import { orderStockShort } from "@/lib/stock";

/**
 * Prices, visibility and the cart quote (Phase 2). The same quoteCart() runs
 * for the retailer's cart preview, the sales agent's order screen and order
 * placement, so what the retailer sees is what gets billed. The client only
 * ever sends product ids and quantities — never a price.
 *
 * Rate for a retailer = their own special rate ?? their price list's rate ??
 * the product's default rate.
 *
 * Visibility and targeting: a product (or scheme, banner) with no areas /
 * groups (/ retailers) set is for everyone; otherwise a retailer sees it when
 * their area, any of their groups (or the retailer itself) is listed.
 */

export type RetailerCtx = { id: string; areaId: string; priceListId: string | null; groupIds: string[] };

export async function retailerPricingCtx(tx: Tx, retailerId: string): Promise<RetailerCtx | null> {
  const r = await tx.retailerProfile.findUnique({
    where: { id: retailerId },
    select: { id: true, areaId: true, priceListId: true, groups: { select: { groupId: true } } },
  });
  if (!r) return null;
  return { id: r.id, areaId: r.areaId, priceListId: r.priceListId, groupIds: r.groups.map((g) => g.groupId) };
}

export function visibleTo(p: { visibleAreaIds: string[]; visibleGroupIds: string[] }, r: RetailerCtx): boolean {
  if (!p.visibleAreaIds.length && !p.visibleGroupIds.length) return true;
  return p.visibleAreaIds.includes(r.areaId) || p.visibleGroupIds.some((g) => r.groupIds.includes(g));
}

export function targets(s: { areaIds: string[]; groupIds: string[]; retailerIds?: string[] }, r: RetailerCtx): boolean {
  const ids = s.retailerIds ?? [];
  if (!s.areaIds.length && !s.groupIds.length && !ids.length) return true;
  return s.areaIds.includes(r.areaId) || s.groupIds.some((g) => r.groupIds.includes(g)) || ids.includes(r.id);
}

export function inWindow(s: { startsAt: Date | null; endsAt: Date | null }, now: Date): boolean {
  return (!s.startsAt || s.startsAt <= now) && (!s.endsAt || s.endsAt >= now);
}

/** Retailer's margin % on MRP after paying this rate plus GST (one decimal). inclusive: the rate already has GST in it. */
export function marginPct(price: number, gstRate: number, mrp: number, inclusive = false): number | null {
  if (mrp <= 0) return null;
  const landed = inclusive ? price : price * (1 + gstRate / 100);
  return Math.round(((mrp - landed) / mrp) * 1000) / 10;
}

export type PriceSource = "retailer" | "list" | "default";

export type CatalogueProduct = {
  id: string;
  name: string;
  nameHi: string | null;
  sku: string;
  description: string | null;
  unit: string;
  caseUnit: string | null;
  caseSize: number | null;
  moq: number;
  mrp: number;
  gstRate: number;
  hsnCode: string | null;
  specialOffer: string | null;
  images: string[];
  sort: number;
  category: { id: string; name: string };
  categoryPath: string[];
  brand: { id: string; name: string } | null;
  /** Default rate (before price list / special rate). */
  basePrice: number;
  /** This retailer's rate before GST, paise per base unit. */
  price: number;
  priceSource: PriceSource;
  margin: number | null;
  /** For client-side search (Hindi ↔ English). */
  search: string;
};

/** Each category's id plus all its parents', by category id. */
export async function categoryPaths(tx: Tx): Promise<Map<string, string[]>> {
  const cats = await tx.category.findMany({ select: { id: true, parentId: true } });
  const parent = new Map(cats.map((c) => [c.id, c.parentId]));
  const out = new Map<string, string[]>();
  for (const c of cats) {
    const path = [c.id];
    let p = parent.get(c.id) ?? null;
    while (p && !path.includes(p) && path.length < 10) {
      path.push(p);
      p = parent.get(p) ?? null;
    }
    out.set(c.id, path);
  }
  return out;
}

/**
 * Active products this retailer can see, with their rate. `productIds` limits
 * the lookup (cart); hidden products are left out unless `includeHidden`.
 */
export async function catalogueFor(
  tx: Tx,
  r: RetailerCtx,
  opts: { productIds?: string[]; includeHidden?: boolean; inclusive?: boolean } = {}
): Promise<CatalogueProduct[]> {
  const idFilter = opts.productIds ? { id: { in: opts.productIds } } : {};
  const [products, paths, listItems, special] = await Promise.all([
    tx.product.findMany({
      where: { active: true, ...idFilter },
      include: { category: { select: { id: true, name: true } }, brand: { select: { id: true, name: true } } },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    }),
    categoryPaths(tx),
    r.priceListId
      ? tx.priceListItem.findMany({
          where: { priceListId: r.priceListId, priceList: { active: true }, ...(opts.productIds ? { productId: { in: opts.productIds } } : {}) },
          select: { productId: true, price: true },
        })
      : Promise.resolve([]),
    tx.retailerPrice.findMany({
      where: { retailerId: r.id, ...(opts.productIds ? { productId: { in: opts.productIds } } : {}) },
      select: { productId: true, price: true },
    }),
  ]);
  const list = new Map(listItems.map((i) => [i.productId, i.price]));
  const mine = new Map(special.map((i) => [i.productId, i.price]));

  return products
    .filter((p) => opts.includeHidden || visibleTo(p, r))
    .map((p) => {
      const own = mine.get(p.id);
      const listed = list.get(p.id);
      const price = own ?? listed ?? p.price;
      const priceSource: PriceSource = own !== undefined ? "retailer" : listed !== undefined ? "list" : "default";
      return {
        id: p.id,
        name: p.name,
        nameHi: p.nameHi,
        sku: p.sku,
        description: p.description,
        unit: p.unit,
        caseUnit: p.caseUnit,
        caseSize: p.caseSize,
        moq: p.moq,
        mrp: p.mrp,
        gstRate: p.gstRate,
        hsnCode: p.hsnCode,
        specialOffer: p.specialOffer,
        images: p.images,
        sort: p.sort,
        category: p.category,
        categoryPath: paths.get(p.categoryId) ?? [p.categoryId],
        brand: p.brand,
        basePrice: p.price,
        price,
        priceSource,
        margin: marginPct(price, p.gstRate, p.mrp, opts.inclusive),
        search: searchText([p.name, p.nameHi, p.aliases, p.sku, p.brand?.name, p.category.name]),
      };
    });
}

export const normaliseCoupon = (c: unknown) => (typeof c === "string" ? c.trim().toUpperCase().slice(0, 30) : "");

export type OfferedScheme = {
  id: string;
  name: string;
  description: string | null;
  type: Scheme["type"];
  summary: string;
  productIds: string[];
  brandIds: string[];
  categoryIds: string[];
  endsAt: Date | null;
  coupon: boolean;
};

/**
 * Schemes running now for this retailer. Coupon schemes are included only
 * when `coupon` matches. `offers` = what to show the retailer (no coupon codes).
 */
export async function schemesFor(tx: Tx, r: RetailerCtx, now: Date, coupon?: string | null) {
  const rows = await tx.scheme.findMany({
    where: {
      active: true,
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  const mineRows = rows.filter((s) => targets(s, r));
  const code = normaliseCoupon(coupon);
  const couponScheme = code ? mineRows.find((s) => s.couponCode === code) ?? null : null;
  const usable = mineRows.filter((s) => !s.couponCode || s === couponScheme);

  const limited = usable.filter((s) => s.maxUsesPerRetailer !== null).map((s) => s.id);
  const used = new Map<string, number>();
  if (limited.length) {
    const red = await tx.schemeRedemption.groupBy({
      by: ["schemeId"],
      where: { retailerId: r.id, schemeId: { in: limited }, reversed: false },
      _count: { _all: true },
    });
    for (const x of red) used.set(x.schemeId, x._count._all);
  }

  const freeIds = usable.map((s) => (s.params as { freeProductId?: string | null }).freeProductId).filter((x): x is string => !!x);
  const freeNames = new Map(
    freeIds.length ? (await tx.product.findMany({ where: { id: { in: freeIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]) : []
  );
  const summary = (s: Scheme) => describeScheme(s.type, s.params, freeNames.get((s.params as { freeProductId?: string }).freeProductId ?? "") ?? null);

  const engine: EngineScheme[] = usable.map((s) => ({
    id: s.id,
    name: s.name,
    type: s.type,
    params: s.params as unknown as SchemeParams,
    productIds: s.productIds,
    brandIds: s.brandIds,
    categoryIds: s.categoryIds,
    stackable: s.stackable,
    priority: s.priority,
    createdAt: s.createdAt,
    budgetLeft: s.budget === null ? null : Math.max(0, s.budget - s.spent),
    usesLeft: s.maxUsesPerRetailer === null ? null : Math.max(0, s.maxUsesPerRetailer - (used.get(s.id) ?? 0)),
  }));

  const offers: OfferedScheme[] = usable
    .filter((s) => (s.budget === null || s.spent < s.budget) && (s.maxUsesPerRetailer === null || (used.get(s.id) ?? 0) < s.maxUsesPerRetailer))
    .map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      type: s.type,
      summary: summary(s),
      productIds: s.productIds,
      brandIds: s.brandIds,
      categoryIds: s.categoryIds,
      endsAt: s.endsAt,
      coupon: !!s.couponCode,
    }));

  return { engine, offers, couponScheme, code };
}

// ───────────────────────────── quote ─────────────────────────────

export type CartItemInput = { productId: string; quantity?: number; cases?: number };

export type QuoteLine = {
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  cases: number | null;
  caseSize: number | null;
  caseUnit: string | null;
  price: number;
  mrp: number;
  gstRate: number;
  priceSource: PriceSource;
  /** Before GST (also when rates include GST), so gross − discount = taxable. */
  gross: number;
  discount: number;
  taxable: number;
  gst: number;
  total: number;
  /** Scheme discount as charged against the rate (includes GST when rates do) — what the order line stores. */
  itemDiscount: number;
  /** price includes GST. */
  inclusive: boolean;
  /** Scheme names that changed this line. */
  schemes: string[];
};
export type QuoteFree = { productId: string; name: string; unit: string; quantity: number; schemeId: string; schemeName: string; value: number; mrp: number; gstRate: number };

export type Quote = {
  lines: QuoteLine[];
  free: QuoteFree[];
  applied: (AppliedScheme & { summary: string })[];
  grossAmount: number;
  discountAmount: number;
  /** Goods after discount, before GST — what the minimum and free delivery look at. */
  goodsValue: number;
  deliveryCharge: number;
  deliveryGstRate: number;
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  minOrderValue: number;
  /** Paise more goods needed to reach the minimum; 0 = fine. */
  shortBy: number;
  deliveryDates: string[];
  deliveryDate: string | null;
  coupon: { code: string; valid: boolean; message: string } | null;
  /** Reasons the order can't be placed as it stands (empty = OK). */
  problems: string[];
  /** Things to know that don't stop the order (stock short when the business only warns). */
  warnings: string[];
  /** Products asked for beyond available stock: productId → units available. */
  stockShort: Record<string, number>;
  priceListId: string | null;
  /** Schemes for this retailer right now (to show "add 2 more for …"). */
  offers: OfferedScheme[];
};

const MAX_QTY = 100_000;

export async function quoteCart(
  tx: Tx,
  tenantSettings: unknown,
  r: RetailerCtx,
  input: { items: CartItemInput[]; coupon?: string | null; deliveryDate?: string | null; skipStockCheck?: boolean },
  now = new Date()
): Promise<Quote> {
  const problems: string[] = [];
  const cart = cartSettings(tenantSettings);
  // A composition dealer can't charge GST: bills of supply, every rate 0.
  const taxRate = (rate: number) => (invoiceSettings(tenantSettings).scheme === "composition" ? 0 : rate);
  const deliveryGstRate = taxRate(cart.deliveryGstRate);

  // Merge repeated products; cases → base units.
  const wanted = new Map<string, { quantity: number; cases: number | null }>();
  const ids = [...new Set(input.items.map((i) => i.productId).filter((x) => typeof x === "string"))];
  const products = new Map((await catalogueFor(tx, r, { productIds: ids })).map((p) => [p.id, p]));
  let missing = false;
  for (const it of input.items) {
    const p = products.get(it.productId);
    if (!p) {
      missing = true;
      continue;
    }
    const cases = it.cases ?? null;
    if (cases !== null && (!Number.isInteger(cases) || cases < 1 || !p.caseSize)) {
      problems.push(`${p.name}: cases must be a whole number of at least 1`);
      continue;
    }
    const qty = cases !== null ? cases * p.caseSize! : it.quantity;
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      problems.push(`${p.name}: quantity must be a whole number of at least 1`);
      continue;
    }
    const w = wanted.get(p.id) ?? { quantity: 0, cases: 0 };
    if (w.quantity + qty > MAX_QTY) {
      problems.push(`${p.name}: quantity must be a whole number of at least 1`);
      continue;
    }
    w.quantity += qty;
    w.cases = cases !== null && w.cases !== null ? w.cases + cases : null;
    wanted.set(p.id, w);
  }
  if (missing) problems.push("Some products are no longer available. Remove them and try again.");

  const cartLines = [...wanted.entries()].map(([id, w]) => ({ p: products.get(id)!, ...w }));
  for (const l of cartLines) {
    if (l.quantity < l.p.moq) problems.push(`${l.p.name}: order at least ${l.p.moq} ${l.p.unit}`);
  }

  const { engine, offers, couponScheme, code } = await schemesFor(tx, r, now, input.coupon);
  // Free products may not be in the cart: look up their rate for this retailer.
  const freeIds = engine.map((s) => (s.params as { freeProductId?: string | null }).freeProductId).filter((x): x is string => !!x && !products.has(x));
  if (freeIds.length) for (const p of await catalogueFor(tx, r, { productIds: freeIds })) products.set(p.id, p);

  const engineLines: EngineLine[] = cartLines.map((l) => ({
    productId: l.p.id,
    categoryPath: l.p.categoryPath,
    brandId: l.p.brand?.id ?? null,
    quantity: l.quantity,
    price: l.p.price,
  }));
  const result = applySchemes(engineLines, engine, (id) => products.get(id)?.price ?? null);
  const byScheme = new Map(engine.map((s) => [s.id, s]));
  const offerById = new Map(offers.map((o) => [o.id, o]));

  const inclusive = invoiceSettings(tenantSettings).ratesIncludeGst;
  const lines: QuoteLine[] = cartLines.map((l, i) => {
    const itemDiscount = result.discounts[i];
    const m = lineMoney(l.p.price, l.quantity, itemDiscount, taxRate(l.p.gstRate), inclusive);
    const { gross, discount, taxable } = m;
    const gst = m.tax;
    return {
      productId: l.p.id,
      name: l.p.name,
      unit: l.p.unit,
      quantity: l.quantity,
      cases: l.cases && l.cases > 0 ? l.cases : null,
      caseSize: l.p.caseSize,
      caseUnit: l.p.caseUnit,
      price: l.p.price,
      mrp: l.p.mrp,
      gstRate: taxRate(l.p.gstRate),
      priceSource: l.p.priceSource,
      gross,
      discount,
      taxable,
      gst,
      total: taxable + gst,
      itemDiscount,
      inclusive,
      schemes: [],
    };
  });
  lines.forEach((ln, i) => (ln.schemes = result.lineSchemes[i].map((id) => byScheme.get(id)!.name)));

  const free: QuoteFree[] = result.free.map((g) => {
    const p = products.get(g.productId)!;
    return {
      productId: g.productId,
      name: p.name,
      unit: p.unit,
      quantity: g.quantity,
      schemeId: g.schemeId,
      schemeName: byScheme.get(g.schemeId)!.name,
      value: g.quantity * g.unitPrice,
      mrp: p.mrp,
      gstRate: taxRate(p.gstRate),
    };
  });

  const grossAmount = lines.reduce((a, l) => a + l.gross, 0);
  const discountAmount = lines.reduce((a, l) => a + l.discount, 0);
  const goodsValue = grossAmount - discountAmount;
  const deliveryCharge = lines.length ? deliveryChargeFor(cart, goodsValue) : 0;
  const gstAmount = lines.reduce((a, l) => a + l.gst, 0) + gstOn(deliveryCharge, deliveryGstRate);
  const subtotal = goodsValue + deliveryCharge;
  const shortBy = lines.length && cart.minOrderValue > goodsValue ? cart.minOrderValue - goodsValue : 0;
  if (!lines.length && !problems.length) problems.push("Add at least one product");
  if (shortBy > 0) problems.push(`Minimum order is ${formatINR(cart.minOrderValue, { whole: true })} of goods. Add ${formatINR(shortBy)} more.`);

  const dates = deliveryDays(cart, now);
  let deliveryDate: string | null = dates[0] ?? null;
  if (input.deliveryDate) {
    if (dates.includes(input.deliveryDate)) deliveryDate = input.deliveryDate;
    else problems.push("That delivery day isn't available. Pick another.");
  }

  // Stock (Phase 5): warn or refuse when an order asks for more than is available.
  const warnings: string[] = [];
  const stockShort: Record<string, number> = {};
  const need = new Map<string, number>();
  for (const l of lines) need.set(l.productId, (need.get(l.productId) ?? 0) + l.quantity);
  for (const f of free) need.set(f.productId, (need.get(f.productId) ?? 0) + f.quantity);
  const stock = input.skipStockCheck ? { mode: "off" as const, short: [] } : await orderStockShort(tx, tenantSettings, need);
  for (const x of stock.short) {
    const p = products.get(x.productId)!;
    stockShort[x.productId] = x.available;
    const msg = x.available > 0 ? `${p.name}: only ${x.available} ${p.unit} in stock` : `${p.name} is out of stock`;
    (stock.mode === "block" ? problems : warnings).push(msg);
  }

  let coupon: Quote["coupon"] = null;
  if (code) {
    const used = couponScheme ? result.applied.find((a) => a.schemeId === couponScheme.id) : null;
    coupon = !couponScheme
      ? { code, valid: false, message: "This coupon isn't valid for you" }
      : used
        ? { code, valid: true, message: `${couponScheme.name} applied` }
        : { code, valid: false, message: offerById.has(couponScheme.id) ? "Your cart doesn't qualify for this coupon yet" : "This coupon has been used up" };
    if (!coupon.valid) problems.push(coupon.message);
  }

  return {
    lines,
    free,
    applied: result.applied.map((a) => ({ ...a, summary: offerById.get(a.schemeId)?.summary ?? describeScheme(a.type, byScheme.get(a.schemeId)!.params) })),
    grossAmount,
    discountAmount,
    goodsValue,
    deliveryCharge,
    deliveryGstRate,
    subtotal,
    gstAmount,
    totalAmount: subtotal + gstAmount,
    minOrderValue: cart.minOrderValue,
    shortBy,
    deliveryDates: dates,
    deliveryDate,
    coupon,
    problems,
    warnings,
    stockShort,
    priceListId: r.priceListId,
    offers: offers.filter((o) => !o.coupon || o.id === couponScheme?.id),
  };
}
