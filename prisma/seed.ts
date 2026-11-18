/**
 * Demo seed: two isolated tenants so tenant separation can be seen and tested.
 *
 *   demo   → http://demo.localhost:3100   (the original demo data set)
 *   second → http://second.localhost:3100 (a small second distributor)
 *
 * Every tenant's rows are written through tenantDb(), so row-level security
 * stamps and checks tenantId exactly as the app does at runtime.
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";
import { nextOrderNumber, priceBreakup } from "../src/lib/orders";
import { toPaise } from "../src/lib/money";
import { onOrderDelivered, onOrderPlaced, openingBalance, recordPayment, withMoney } from "../src/lib/ledger";

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

type Db = ReturnType<typeof scoped>;

async function wipe() {
  // Dev-only wipe. TRUNCATE (table owner only) is used because the audit log
  // is append-only: its policies refuse DELETE even for platform jobs.
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to wipe a production database");
  await prisma.$executeRawUnsafe(
    `TRUNCATE ${[
      "PaymentAllocation", "Cheque", "CashHandover", "Payment", "Bill", "LedgerLine", "JournalEntry", "LedgerAccount",
      "AuditLog", "Counter", "OtpChallenge", "Delivery", "Visit", "Attendance",
      "OrderStatusEvent", "OrderItem", "Order", "Product", "Beat",
      "RetailerProfile", "SalesAgentProfile", "DeliveryAgentProfile", "Area", "Region", "User",
      "TenantDomain", "Tenant",
    ].map((t) => `"${t}"`).join(", ")} CASCADE`
  );
}

type ProductRow = [string, string, string, string, number, number, number, string | null];

async function seedProducts(db: Db, rows: ProductRow[]) {
  const out = [];
  for (const [name, sku, category, unit, price, mrp, gstRate, specialOffer] of rows) {
    out.push(
      await db.product.create({
        data: { name, sku, category, unit, price: toPaise(price), mrp: toPaise(mrp), gstRate, specialOffer },
      })
    );
  }
  return out;
}

async function seedDemo() {
  const tenant = await prisma.tenant.create({
    data: { slug: "demo", name: "Setu Demo Distributors", status: "ACTIVE", plan: "growth", stateCode: "27" },
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
    ["Instant Coffee 100g", "BEV-002", "Beverages", "jar", 220, 240, 18, "Buy 2 get 5% off"],
    ["Potato Chips 150g", "SNK-001", "Snacks", "pack", 40, 45, 12, null],
    ["Chocolate Cookies 200g", "SNK-002", "Snacks", "pack", 60, 65, 18, null],
    ["Toor Dal 1kg", "GRO-001", "Grocery", "pack", 140, 150, 5, null],
    ["Basmati Rice 5kg", "GRO-002", "Grocery", "bag", 520, 560, 5, "Festive price, limited stock"],
    ["Sunflower Oil 1L", "GRO-003", "Grocery", "bottle", 165, 175, 5, null],
    ["Toothpaste 150g", "PC-001", "Personal Care", "tube", 90, 99, 18, null],
    ["Bathing Soap (pack of 4)", "PC-002", "Personal Care", "pack", 120, 130, 18, "Flat 8% off this week"],
    ["Dish Wash Liquid 500ml", "HH-001", "Household", "bottle", 95, 105, 18, null],
  ]);

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
      placedById: retailer1.id,
      status: "DELIVERED",
      ...b1,
      items: { create: delivered },
      statusEvents: {
        create: [
          { status: "PLACED", actorId: retailer1.id },
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
      placedById: retailer2.id,
      status: "PLACED",
      ...b2,
      items: { create: placed },
      statusEvents: { create: { status: "PLACED", actorId: retailer2.id } },
    },
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
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { money: { upiVpa: "setudemo@okaxis", upiPayeeName: "Setu Demo Distributors", chequeBouncePenalty: toPaise(250) } } },
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
      cheque: { number: "004512", bank: "HDFC Bank", date: days(0) },
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
}

async function seedSecond() {
  const tenant = await prisma.tenant.create({
    data: { slug: "second", name: "Second Agencies", status: "TRIAL", stateCode: "09" },
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
  console.log("  Retailer OTP phones: 9876543210, 9123456780");
  console.log("Tenant 'second' → http://second.localhost:3100");
  console.log("  Admin: admin / second123 · Retailer OTP phone: 9876543210");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
