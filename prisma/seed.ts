/**
 * Demo seed: two isolated tenants so tenant separation can be seen and tested.
 *
 *   demo   → http://demo.localhost:3100   (the original demo data set)
 *   second → http://second.localhost:3100 (a small second distributor)
 *
 * Every tenant's rows are written through tenantDb(), so row-level security
 * stamps and checks tenantId exactly as the app does at runtime.
 */
import { DELIVERY_DEFAULTS } from "../src/lib/delivery-settings";
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";
import { nextOrderNumber, priceBreakup } from "../src/lib/orders";
import { toPaise } from "../src/lib/money";
import { issueCreditNote, onOrderDelivered, onOrderPlaced, openingBalance, recordPayment, withMoney } from "../src/lib/ledger";
import { generateEInvoice } from "../src/lib/einvoice";
import { gstinCheckDigit } from "../src/lib/gst";
import { adjustStock, draftReorderPos, receiveGoods, setPoStatus } from "../src/lib/stock";
import { seedField } from "./seed-field";

/** Made-up GSTIN with a valid check digit (test data only). */
const testGstin = (first14: string) => `${first14}${gstinCheckDigit(first14)}`;

const prisma = new PrismaClient();

function scoped(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type Db = ReturnType<typeof scoped>;

async function wipe() {
  // Dev-only wipe. TRUNCATE (table owner only) is used because the audit log
  // is append-only: its policies refuse DELETE even for platform jobs.
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to wipe a production database");
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${[
      "StockMove", "PurchaseLine", "Purchase", "PurchaseOrderLine", "PurchaseOrder", "StockLot", "StockLocation", "Supplier",
      "ReturnableMove", "Returnable", "DutyShift", "Trip", "Vehicle",
      "InvoiceLine", "Invoice",
      "SchemeRedemption", "Scheme", "Banner", "RetailerPrice", "PriceListItem", "PriceList",
      "RetailerGroupMember", "RetailerGroup", "HsnCode", "Brand", "Category",
      "PaymentAllocation", "Cheque", "CashHandover", "Payment", "Bill", "LedgerLine", "JournalEntry", "LedgerAccount",
      "HandoffUse", "Target", "StoreLead", "LeaveRequest", "LocationPing", "BeatPlan", "BeatRetailer",
      "AuditLog", "Counter", "OtpChallenge", "Delivery", "Visit", "Attendance",
      "OrderStatusEvent", "OrderItem", "Order", "Product", "Beat",
      "RetailerProfile", "SalesAgentProfile", "DeliveryAgentProfile", "Area", "Region", "User",
      "TenantDomain", "Tenant",
    ].map((t) => `"${t}"`).join(", ")} CASCADE`
  );
}

type ProductRow = [string, string, string, string, number, number, number, string | null];
/** Optional extras per SKU: brand, Hindi name, HSN code, case pack. */
type Extra = { brand?: string; nameHi?: string; hsn?: string; caseUnit?: string; caseSize?: number; aliases?: string };

async function seedProducts(db: Db, rows: ProductRow[], extras: Record<string, Extra> = {}) {
  const cats = new Map<string, string>();
  const brands = new Map<string, string>();
  const out = [];
  let sort = 0;
  for (const [name, sku, category, unit, price, mrp, gstRate, specialOffer] of rows) {
    if (!cats.has(category)) cats.set(category, (await db.category.create({ data: { name: category, sort: cats.size } })).id);
    const x = extras[sku] ?? {};
    if (x.brand && !brands.has(x.brand)) brands.set(x.brand, (await db.brand.create({ data: { name: x.brand, sort: brands.size } })).id);
    out.push(
      await db.product.create({
        data: {
          name,
          sku,
          categoryId: cats.get(category)!,
          brandId: x.brand ? brands.get(x.brand)! : null,
          nameHi: x.nameHi ?? null,
          aliases: x.aliases ?? null,
          hsnCode: x.hsn ?? null,
          caseUnit: x.caseUnit ?? null,
          caseSize: x.caseSize ?? null,
          unit,
          price: toPaise(price),
          mrp: toPaise(mrp),
          gstRate,
          specialOffer,
          sort: sort++,
        },
      })
    );
  }
  return out;
}

async function seedDemo() {
  const tenant = await prisma.tenant.create({
    data: {
      slug: "demo",
      name: "Setu Demo Distributors",
      legalName: "Setu Demo Distributors (Demo)",
      gstin: testGstin("27ZZDEM0001A1Z"),
      address: "Unit 4, Demo Industrial Estate, Andheri East",
      status: "ACTIVE",
      plan: "growth",
      stateCode: "27",
    },
  });
  const db = scoped(tenant.id);

  const mumbai = await db.region.create({
    data: {
      name: "Mumbai",
      areas: { create: [{ name: "Andheri" }, { name: "Bandra" }, { name: "Dadar" }] },
    },
    include: { areas: true },
  });
  await db.region.create({
    data: { name: "Pune", areas: { create: [{ name: "Kothrud" }, { name: "Hadapsar" }] } },
  });

  await db.user.create({
    data: { name: "Admin", loginId: "admin", passwordHash: hashPassword("admin123"), role: "ADMIN" },
  });

  const salesUser = await db.user.create({
    data: {
      name: "Test Agent",
      loginId: "Test agent",
      passwordHash: hashPassword("123456789"),
      role: "SALES_AGENT",
      salesAgentProfile: { create: {} },
    },
    include: { salesAgentProfile: true },
  });

  const deliveryUser = await db.user.create({
    data: {
      name: "Delivery Agent",
      loginId: "deliveryagent@gmail.com",
      email: "deliveryagent@gmail.com",
      passwordHash: hashPassword("123456789"),
      role: "DELIVERY_AGENT",
      deliveryAgentProfile: { create: {} },
    },
    include: { deliveryAgentProfile: true },
  });

  const products = await seedProducts(db, [
    ["Masala Chai 250g", "BEV-001", "Beverages", "pack", 85, 95, 5, null],
    ["Instant Coffee 100g", "BEV-002", "Beverages", "jar", 220, 285, 18, "Buy 2 get 5% off"],
    ["Potato Chips 150g", "SNK-001", "Snacks", "pack", 40, 50, 12, null],
    ["Chocolate Cookies 200g", "SNK-002", "Snacks", "pack", 60, 80, 18, null],
    ["Toor Dal 1kg", "GRO-001", "Grocery", "pack", 140, 150, 5, null],
    ["Basmati Rice 5kg", "GRO-002", "Grocery", "bag", 520, 560, 5, "Festive price, limited stock"],
    ["Sunflower Oil 1L", "GRO-003", "Grocery", "bottle", 165, 175, 5, null],
    ["Toothpaste 150g", "PC-001", "Personal Care", "tube", 90, 120, 18, null],
    ["Bathing Soap (pack of 4)", "PC-002", "Personal Care", "pack", 120, 160, 18, "Flat 8% off this week"],
    ["Dish Wash Liquid 500ml", "HH-001", "Household", "bottle", 95, 125, 18, null],
  ], {
    // Brand names are made up for the demo.
    "BEV-001": { brand: "Sunrise", nameHi: "मसाला चाय", hsn: "0902", caseUnit: "box", caseSize: 24, aliases: "tea" },
    "BEV-002": { brand: "Sunrise", nameHi: "इंस्टेंट कॉफ़ी", hsn: "2101", caseUnit: "box", caseSize: 12 },
    "SNK-001": { brand: "Crunchy", nameHi: "आलू चिप्स", hsn: "2005", caseUnit: "carton", caseSize: 30, aliases: "wafers" },
    "SNK-002": { brand: "Crunchy", nameHi: "चॉकलेट बिस्कुट", hsn: "1905", caseUnit: "carton", caseSize: 24, aliases: "biscuit" },
    "GRO-001": { brand: "Kisan Gold", nameHi: "तूर दाल", hsn: "0713", aliases: "arhar" },
    "GRO-002": { brand: "Kisan Gold", nameHi: "बासमती चावल", hsn: "1006", aliases: "chawal" },
    "GRO-003": { brand: "Kisan Gold", nameHi: "सूरजमुखी तेल", hsn: "1512", caseUnit: "carton", caseSize: 12, aliases: "tel" },
    "PC-001": { brand: "Fresh Smile", nameHi: "टूथपेस्ट", hsn: "3306", caseUnit: "box", caseSize: 36 },
    "PC-002": { brand: "Fresh Smile", nameHi: "नहाने का साबुन", hsn: "3401", caseUnit: "box", caseSize: 12, aliases: "sabun" },
    "HH-001": { brand: "Ghar Clean", nameHi: "बर्तन धोने का लिक्विड", hsn: "3402", caseUnit: "box", caseSize: 24 },
  });
  for (const [code, rate, description] of [
    ["0902", 5, "Tea"], ["2101", 18, "Coffee extracts"], ["2005", 12, "Prepared vegetables, chips"], ["1905", 18, "Biscuits"],
    ["0713", 5, "Pulses"], ["1006", 5, "Rice"], ["1512", 5, "Sunflower oil"], ["3306", 18, "Oral care"],
    ["3401", 18, "Soap"], ["3402", 18, "Cleaning preparations"],
  ] as const) {
    await db.hsnCode.create({ data: { code, gstRate: rate, description } });
  }

  const retailer1 = await db.user.create({
    data: {
      name: "Agarwal General Store",
      phone: "9876543210",
      role: "RETAILER",
      retailerProfile: {
        create: {
          outletName: "Agarwal General Store",
          shopNumber: "G-12",
          complexName: "Shree Complex",
          pinCode: "400058",
          gstin: testGstin("27ZZAGR0001B1Z"),
          lat: 19.1197,
          lng: 72.8468,
          deliveryPref: "IN_HAND",
          deliveryNote: "Side lane entrance after 11 AM",
          areaId: mumbai.areas[0].id,
          salesAgentId: salesUser.salesAgentProfile!.id,
        },
      },
    },
    include: { retailerProfile: true },
  });

  const retailer2 = await db.user.create({
    data: {
      name: "Patel Kirana Store",
      phone: "9123456780",
      role: "RETAILER",
      retailerProfile: {
        create: {
          outletName: "Patel Kirana Store",
          shopNumber: "14",
          complexName: "Lotus Plaza",
          pinCode: "400050",
          lat: 19.0544,
          lng: 72.8402,
          deliveryPref: "RING_BELL",
          areaId: mumbai.areas[1].id,
          salesAgentId: salesUser.salesAgentProfile!.id,
        },
      },
    },
    include: { retailerProfile: true },
  });

  const delivered = [
    { productId: products[0].id, quantity: 4, price: products[0].price, gstRate: products[0].gstRate },
    { productId: products[2].id, quantity: 10, price: products[2].price, gstRate: products[2].gstRate },
  ];
  const b1 = priceBreakup(delivered);
  const deliveredOrder = await db.order.create({
    data: {
      orderNumber: await nextOrderNumber(db, tenant.id),
      retailerId: retailer1.retailerProfile!.id,
      placedById: salesUser.id, // taken by the sales agent on a visit
      status: "DELIVERED",
      ...b1,
      grossAmount: b1.subtotal,
      items: { create: delivered },
      statusEvents: {
        create: [
          { status: "PLACED", actorId: salesUser.id },
          { status: "CONFIRMED", actorId: salesUser.id },
          { status: "PACKED", actorId: salesUser.id },
          { status: "OUT_FOR_DELIVERY", actorId: deliveryUser.id },
          { status: "DELIVERED", actorId: deliveryUser.id },
        ],
      },
      delivery: {
        create: {
          deliveryAgentId: deliveryUser.deliveryAgentProfile!.id,
          deliveredAt: new Date(),
          paymentMethod: "CASH",
          paymentStatus: "COLLECTED",
          codAmount: b1.totalAmount,
          state: "DELIVERED",
          seq: 1,
        },
      },
    },
  });

  const placed = [
    { productId: products[4].id, quantity: 5, price: products[4].price, gstRate: products[4].gstRate },
    { productId: products[6].id, quantity: 3, price: products[6].price, gstRate: products[6].gstRate },
  ];
  const b2 = priceBreakup(placed);
  const placedOrder = await db.order.create({
    data: {
      orderNumber: await nextOrderNumber(db, tenant.id),
      retailerId: retailer2.retailerProfile!.id,
      placedById: salesUser.id,
      status: "PLACED",
      ...b2,
      grossAmount: b2.subtotal,
      items: { create: placed },
      statusEvents: { create: { status: "PLACED", actorId: salesUser.id } },
    },
  });

  const retailer3 = await db.user.create({
    data: {
      name: "Sai Super Mart",
      phone: "9988776655",
      role: "RETAILER",
      retailerProfile: {
        create: {
          outletName: "Sai Super Mart",
          shopNumber: "1",
          complexName: "Station Road",
          pinCode: "400014",
          gstin: testGstin("27ZZSAI0001C1Z"),
          legalName: "Sai Retail Enterprises",
          areaId: mumbai.areas[2].id,
          salesAgentId: salesUser.salesAgentProfile!.id,
        },
      },
    },
    include: { retailerProfile: true },
  });

  await seedPricing(db, tenant.id, {
    products,
    agarwal: retailer1.retailerProfile!.id,
    sai: retailer3.retailerProfile!.id,
    bandraId: mumbai.areas[1].id,
  });

  // Phase 4: vans and crates. Sai Super Mart has no map pin yet (taken on first delivery).
  await db.vehicle.createMany({
    data: [
      { number: "MH02AB1234", name: "Tata Ace (white)", capacityKg: 750 },
      { number: "MH04CD5678", name: "Mahindra pickup", capacityKg: 1200 },
    ],
  });
  await db.returnable.createMany({
    data: [
      { name: "Crate", nameHi: "क्रेट", unitCharge: 15000, sort: 0 },
      { name: "20 L jar", nameHi: "20 लीटर जार", unitCharge: 20000, sort: 1 },
    ],
  });
  const tenantRow = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { settings: { ...(tenantRow.settings as object), delivery: { ...DELIVERY_DEFAULTS, depot: { lat: 19.0728, lng: 72.8826 }, codeAbove: 500000 } } },
  });

  await seedMoney(tenant.id, {
    adminId: (await db.user.findFirstOrThrow({ where: { loginId: "admin" } })).id,
    salesUserId: salesUser.id,
    deliveryUserId: deliveryUser.id,
    agarwal: retailer1.retailerProfile!.id,
    patel: retailer2.retailerProfile!.id,
    deliveredOrderId: deliveredOrder.id,
    placedOrderId: placedOrder.id,
  });

  await seedStock(tenant.id, (await db.user.findFirstOrThrow({ where: { loginId: "admin" } })).id);

  await seedField(db, {
    salesUserId: salesUser.id,
    salesAgentId: salesUser.salesAgentProfile!.id,
    deliveryUserId: deliveryUser.id,
    adminId: (await db.user.findFirstOrThrow({ where: { loginId: "admin" } })).id,
    areas: mumbai.areas.map((a) => a.id),
    shops: [retailer1.retailerProfile!.id, retailer2.retailerProfile!.id, retailer3.retailerProfile!.id],
    patelOrderId: placedOrder.id,
  });
  // Location tracking on for the demo so the team map has positions (off by default for real businesses).
  const tr = await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id }, select: { settings: true } });
  await prisma.tenant.update({ where: { id: tenant.id }, data: { settings: { ...(tr.settings as object), field: { trackLocation: true } } } });
}

/**
 * Phase 5 demo: stock tracking on (warn when short), one warehouse, five
 * suppliers (made-up names), goods received in batches. Shows:
 *   - Potato Chips: a batch expiring in 5 days (sold first, flagged);
 *   - Chocolate Cookies: 10 packs already expired (to move to damaged);
 *   - Basmati Rice and Bathing Soap: below their reorder level;
 *   - Dish Wash Liquid: out of stock.
 * A draft purchase order for the low items, one marked sent.
 */
async function seedStock(tenantId: string, adminId: string) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...((t.settings ?? {}) as object), inventory: { enabled: true, orderCheck: "warn", bufferPct: 10, expiryAlertDays: 7 } } },
  });
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  await withMoney(tenantId, adminId, async (ctx) => {
    const wh = await ctx.tx.stockLocation.create({ data: { kind: "WAREHOUSE", name: "Bhiwandi warehouse", address: "Gala 14, Shree Logistics Park, Bhiwandi 421302", isDefault: true } });
    const sup = async (name: string, contactName: string, phone: string, gstin: string) =>
      ctx.tx.supplier.create({ data: { name, contactName, phone, gstin: testGstin(gstin) } });
    const sunrise = await sup("Sunrise Beverages Pvt Ltd", "Ramesh Iyer", "9820011111", "27ZZSUN0001A1Z");
    const crunchy = await sup("Crunchy Foods Ltd", "Neha Kulkarni", "9820022222", "27ZZCRU0001A1Z");
    const kisan = await sup("Kisan Gold Agro", "Harpreet Singh", "9820033333", "27ZZKIS0001A1Z");
    const fresh = await sup("Fresh Smile Care", "Anita Desai", "9820044444", "27ZZFRS0001A1Z");
    const ghar = await sup("Ghar Clean Products", "Sanjay Mehta", "9820055555", "27ZZGHR0001A1Z");
    const product = (sku: string) => ctx.tx.product.findFirstOrThrow({ where: { sku } });
    const set = async (sku: string, supplierId: string, reorderLevel: number, reorderQty: number | null, trackExpiry: boolean) =>
      ctx.tx.product.update({ where: { id: (await product(sku)).id }, data: { supplierId, reorderLevel, reorderQty, trackExpiry } });
    await set("BEV-001", sunrise.id, 48, 240, true);
    await set("BEV-002", sunrise.id, 12, 60, true);
    await set("SNK-001", crunchy.id, 60, 150, true);
    await set("SNK-002", crunchy.id, 48, 120, true);
    await set("GRO-001", kisan.id, 40, null, true);
    await set("GRO-002", kisan.id, 50, 40, true);
    await set("GRO-003", kisan.id, 24, 96, true);
    await set("PC-001", fresh.id, 36, 144, false);
    await set("PC-002", fresh.id, 24, 60, false);
    await set("HH-001", ghar.id, 24, 96, false);
    const id = async (sku: string) => (await product(sku)).id;

    await receiveGoods(ctx, {
      supplierId: sunrise.id,
      locationId: wh.id,
      billNo: "SB/2611/0417",
      billDate: day(-6),
      lines: [
        { productId: await id("BEV-001"), quantity: 240, batch: "MC2611A", expiry: day(150), unitCost: 7000 },
        { productId: await id("BEV-002"), quantity: 60, batch: "IC2610C", expiry: day(270), unitCost: 18500 },
      ],
    });
    await receiveGoods(ctx, {
      supplierId: crunchy.id,
      locationId: wh.id,
      billNo: "CF-88213",
      billDate: day(-4),
      lines: [
        { productId: await id("SNK-001"), quantity: 90, batch: "PC0925", expiry: day(5), unitCost: 3200 },
        { productId: await id("SNK-001"), quantity: 150, batch: "PC1105", expiry: day(60), unitCost: 3200 },
        { productId: await id("SNK-002"), quantity: 120, batch: "CC1101", expiry: day(90), unitCost: 4800 },
      ],
    });
    await receiveGoods(ctx, {
      supplierId: kisan.id,
      locationId: wh.id,
      billNo: "KGA/1172",
      billDate: day(-3),
      lines: [
        { productId: await id("GRO-001"), quantity: 200, batch: "TD26-41", expiry: day(240), unitCost: 12000 },
        { productId: await id("GRO-002"), quantity: 40, batch: "BR26-09", expiry: day(330), unitCost: 46000 },
        { productId: await id("GRO-003"), quantity: 96, batch: "SO2611", expiry: day(200), unitCost: 14500 },
      ],
    });
    await receiveGoods(ctx, {
      supplierId: fresh.id,
      locationId: wh.id,
      billNo: "FSC-5521",
      billDate: day(-2),
      lines: [
        { productId: await id("PC-001"), quantity: 144, batch: "TP-0811", unitCost: 7200 },
        { productId: await id("PC-002"), quantity: 12, batch: "BS-0902", unitCost: 9600 },
      ],
    });
    // Ten packs of an older batch that has already expired (opening stock).
    await adjustStock(ctx, { locationId: wh.id, productId: await id("SNK-002"), delta: 10, reason: "opening", batch: "CC0815", expiry: day(-3), unitCost: 4600, note: "Old stock" });
    void ghar;

    const { pos } = await draftReorderPos(ctx);
    if (pos[0]) await setPoStatus(ctx, pos[0].id, "SENT");
  });
}

/**
 * Phase 2 demo: the same product shows different rates and schemes to the
 * three retailers.
 *   Agarwal (Andheri): default rates, plus a special rate on Masala Chai.
 *   Patel (Bandra): default rates; the Bandra-only soap offer.
 *   Sai Super Mart (Dadar): "Wholesale" price list + "Key accounts" group (3% off).
 * Everyone: Masala Chai buy 12 get 1, snacks quantity slab, coupon WELCOME50.
 */
async function seedPricing(
  db: Db,
  tenantId: string,
  ids: { products: { id: string; sku: string; price: number }[]; agarwal: string; sai: string; bandraId: string }
) {
  const p = (sku: string) => ids.products.find((x) => x.sku === sku)!;
  const wholesale = await db.priceList.create({
    data: {
      name: "Wholesale",
      description: "Bulk buyers, about 4% below the default rate",
      items: { create: ids.products.map((x) => ({ productId: x.id, price: Math.round((x.price * 0.96) / 50) * 50 })) },
    },
  });
  const keyAccounts = await db.retailerGroup.create({
    data: { name: "Key accounts", description: "Large outlets", members: { create: [{ retailerId: ids.sai }] } },
  });
  await db.retailerProfile.update({ where: { id: ids.sai }, data: { priceListId: wholesale.id } });
  await db.retailerPrice.create({ data: { retailerId: ids.agarwal, productId: p("BEV-001").id, price: toPaise(82), note: "Agreed on visit" } });

  const snacks = await db.category.findFirstOrThrow({ where: { name: "Snacks" } });
  await db.scheme.create({
    data: { name: "Chai 12 + 1", type: "BUY_X_GET_Y", params: { buyQty: 12, getQty: 1, freeProductId: null, maxSets: null }, productIds: [p("BEV-001").id], priority: 10 },
  });
  await db.scheme.create({
    data: {
      name: "Snacks quantity slab",
      type: "SLAB",
      params: { basis: "qty", slabs: [{ min: 20, percent: 2 }, { min: 50, percent: 4 }], cap: null },
      categoryIds: [snacks.id],
      priority: 20,
    },
  });
  await db.scheme.create({
    data: {
      name: "Soap 6 + dish wash free",
      description: "Bandra launch offer",
      type: "BUY_X_GET_Y",
      params: { buyQty: 6, getQty: 1, freeProductId: p("HH-001").id, maxSets: 5 },
      productIds: [p("PC-002").id],
      areaIds: [ids.bandraId],
      budget: toPaise(5000),
      priority: 30,
    },
  });
  await db.scheme.create({
    data: { name: "Key account 3% off", type: "PERCENT", params: { percent: 3, cap: toPaise(500) }, groupIds: [keyAccounts.id], priority: 200 },
  });
  await db.scheme.create({
    data: {
      name: "Welcome ₹50 off",
      type: "FLAT",
      params: { amount: toPaise(50), perUnit: false, minValue: toPaise(1000) },
      couponCode: "WELCOME50",
      maxUsesPerRetailer: 1,
      priority: 300,
    },
  });
  await db.banner.create({ data: { title: "Chai season", subtitle: "Buy 12 Masala Chai, get 1 free", linkType: "product", linkId: p("BEV-001").id, sort: 0 } });
  await db.banner.create({ data: { title: "Bandra launch", subtitle: "6 soaps + dish wash free", linkType: "product", linkId: p("PC-002").id, areaIds: [ids.bandraId], sort: 1 } });

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        cart: {
          minOrderValue: toPaise(500),
          deliveryCharge: toPaise(30),
          freeDeliveryAbove: toPaise(2000),
          deliveryGstRate: 18,
          cutoffTime: "18:00",
          leadDays: 1,
          closedWeekdays: [0],
          holidays: [],
          allowDateChoice: true,
          maxDaysAhead: 5,
        },
      },
    },
  });
}

/**
 * Money demo data, posted through the real ledger engine so balances, bills
 * and allocations are exactly what the app would produce:
 *   Agarwal (postpaid, ₹10,000 limit): overdue opening balance, a delivered
 *     order paid in cash to the delivery agent, a cheque in hand, a UPI
 *     payment waiting for verification.
 *   Patel (prepaid): wallet recharged by UPI; the open order holds wallet money.
 */
async function seedMoney(
  tenantId: string,
  ids: {
    adminId: string;
    salesUserId: string;
    deliveryUserId: string;
    agarwal: string;
    patel: string;
    deliveredOrderId: string;
    placedOrderId: string;
  }
) {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, TRUE)`;
    await tx.retailerProfile.update({ where: { id: ids.agarwal }, data: { paymentMode: "POSTPAID", creditLimit: toPaise(10000), creditDays: 7 } });
    await tx.retailerProfile.update({ where: { id: ids.patel }, data: { paymentMode: "PREPAID" } });
  });
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      settings: {
        ...((t.settings ?? {}) as object),
        money: { upiVpa: "setudemo@okaxis", upiPayeeName: "Setu Demo Distributors", chequeBouncePenalty: toPaise(250) },
        // Invoices at dispatch; e-invoicing on with the local sandbox (test IRNs).
        invoice: { issueAt: "dispatch", city: "Mumbai", pinCode: "400093", einvoice: { enabled: true, provider: "sandbox" } },
      },
    },
  });

  const days = (n: number) => new Date(Date.now() - n * 86_400_000);
  await withMoney(tenantId, ids.adminId, (ctx) => openingBalance(ctx, ids.agarwal, toPaise(2450), days(20), "Balance from old books"));

  await withMoney(tenantId, ids.deliveryUserId, async (ctx) => {
    const order = await ctx.tx.order.findUniqueOrThrow({ where: { id: ids.deliveredOrderId } });
    await onOrderDelivered(ctx, order, {
      amount: order.totalAmount,
      method: "CASH",
      collectorId: ids.deliveryUserId,
    });
  });
  await withMoney(tenantId, ids.salesUserId, (ctx) =>
    recordPayment(ctx, {
      retailerId: ids.agarwal,
      amount: toPaise(1000),
      method: "CHEQUE",
      cheque: { number: "004512", bank: "Demo Bank", date: days(0) },
      collectorId: ids.salesUserId,
    })
  );
  await withMoney(tenantId, null, (ctx) =>
    recordPayment(ctx, {
      retailerId: ids.agarwal,
      amount: toPaise(500),
      method: "UPI",
      reference: "431298765432",
      note: "Paid on PhonePe",
      needsVerification: true,
      collectorId: null,
    })
  );

  await withMoney(tenantId, ids.adminId, (ctx) =>
    recordPayment(ctx, {
      retailerId: ids.patel,
      amount: toPaise(1500),
      method: "UPI",
      purpose: "WALLET",
      reference: "431211112222",
      atOffice: true,
    })
  );
  await withMoney(tenantId, ids.adminId, async (ctx) => {
    const order = await ctx.tx.order.findUniqueOrThrow({ where: { id: ids.placedOrderId } });
    await onOrderPlaced(ctx, order);
  });

  // Phase 3: one box came back damaged from Agarwal's delivered order → credit note.
  const note = await withMoney(tenantId, ids.adminId, async (ctx) => {
    const inv = await ctx.tx.invoice.findFirstOrThrow({ where: { orderId: ids.deliveredOrderId }, include: { lines: { orderBy: { sl: "asc" } } } });
    return issueCreditNote(ctx, { invoiceId: inv.id, kind: "return", reason: "1 unit damaged in transit", lines: [{ lineId: inv.lines[0].id, quantity: 1 }] });
  });
  // e-Invoices (sandbox) for the B2B documents, as the worker would.
  for (const d of await scoped(tenantId).invoice.findMany({ where: { einvStatus: "PENDING" }, orderBy: { createdAt: "asc" }, select: { id: true } })) {
    await generateEInvoice(tenantId, d.id).catch((e) => console.warn("e-invoice:", e.message));
  }
  void note;
}

async function seedSecond() {
  const tenant = await prisma.tenant.create({
    data: { slug: "second", name: "Second Agencies", status: "TRIAL", stateCode: "09", gstin: testGstin("09ZZSEC0001D1Z") },
  });
  const db = scoped(tenant.id);

  const lucknow = await db.region.create({
    data: { name: "Lucknow", areas: { create: [{ name: "Gomti Nagar" }, { name: "Aliganj" }] } },
    include: { areas: true },
  });

  // Same admin login and same retailer phone as the demo tenant, on purpose:
  // identities are per tenant, so these must not collide.
  await db.user.create({
    data: { name: "Admin", loginId: "admin", passwordHash: hashPassword("second123"), role: "ADMIN" },
  });
  // Phase 6: the demo sales agent also sells for this business (same phone,
  // separate login): the multi-distributor switch.
  const agent2 = await db.user.create({
    data: { name: "Test Agent", loginId: "agent", phone: "9000000002", passwordHash: hashPassword("123456789"), role: "SALES_AGENT", salesAgentProfile: { create: {} } },
    include: { salesAgentProfile: true },
  });
  await seedProducts(db, [
    ["Lemon Drink 300ml (box of 24)", "LD-300", "Beverages", "box", 240, 480, 12, null],
    ["Packaged Water 1L (box of 12)", "PW-1L", "Water", "box", 120, 240, 18, null],
  ]);
  await db.user.create({
    data: {
      name: "Sharma Stores",
      phone: "9876543210",
      role: "RETAILER",
      retailerProfile: {
        create: {
          outletName: "Sharma Stores",
          shopNumber: "3",
          complexName: "Kapoor Market",
          pinCode: "226010",
          areaId: lucknow.areas[0].id,
          salesAgentId: agent2.salesAgentProfile!.id,
        },
      },
    },
  });
}

async function main() {
  console.log("Seeding…");
  await wipe();
  await seedDemo();
  await seedSecond();
  console.log("Seed complete.");
  console.log("Tenant 'demo'   → http://demo.localhost:3100");
  console.log("  Admin: admin / admin123 · Sales: 'Test agent' / 123456789 · Delivery: deliveryagent@gmail.com / 123456789");
  console.log("  Retailer OTP phones: 9876543210 (Agarwal), 9123456780 (Patel), 9988776655 (Sai Super Mart)");
  console.log("  Supervisor: supervisor / 123456789 · Second agent: ravi / 123456789 · Field OTP phones: 9000000001 (supervisor), 9000000002 (Test Agent)");
  console.log("Tenant 'second' → http://second.localhost:3100");
  console.log("  Admin: admin / second123 · Retailer OTP phone: 9876543210 · Test Agent: agent / 123456789 (same phone 9000000002)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
