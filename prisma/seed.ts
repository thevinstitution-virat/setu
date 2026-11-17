import { PrismaClient } from "../src/generated/prisma/client";
import { hashPassword } from "../src/lib/password";
import { generateOrderNumber, priceBreakup } from "../src/lib/orders";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding…");

  const mumbai = await prisma.region.create({
    data: {
      name: "Mumbai",
      areas: { create: [{ name: "Andheri" }, { name: "Bandra" }, { name: "Dadar" }] },
    },
    include: { areas: true },
  });

  const pune = await prisma.region.create({
    data: { name: "Pune", areas: { create: [{ name: "Kothrud" }, { name: "Hadapsar" }] } },
    include: { areas: true },
  });

  await prisma.user.create({
    data: {
      name: "Admin",
      loginId: "admin",
      passwordHash: hashPassword("admin123"),
      role: "ADMIN",
    },
  });

  const salesUser = await prisma.user.create({
    data: {
      name: "Test Agent",
      loginId: "Test agent",
      passwordHash: hashPassword("123456789"),
      role: "SALES_AGENT",
      salesAgentProfile: { create: {} },
    },
    include: { salesAgentProfile: true },
  });

  const deliveryUser = await prisma.user.create({
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

  const products = await Promise.all(
    [
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
    ].map(([name, sku, category, unit, price, mrp, gstRate, specialOffer]) =>
      prisma.product.create({
        data: {
          name: name as string,
          sku: sku as string,
          category: category as string,
          unit: unit as string,
          price: price as number,
          mrp: mrp as number,
          gstRate: gstRate as number,
          specialOffer: specialOffer as string | null,
        },
      })
    )
  );

  const retailerUser = await prisma.user.create({
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

  const retailerUser2 = await prisma.user.create({
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

  void pune;

  // A delivered order (history)
  const deliveredItems = [
    { productId: products[0].id, quantity: 4, price: products[0].price, gstRate: products[0].gstRate },
    { productId: products[2].id, quantity: 10, price: products[2].price, gstRate: products[2].gstRate },
  ];
  const deliveredBreakup = priceBreakup(deliveredItems);
  const deliveredOrder = await prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      retailerId: retailerUser.retailerProfile!.id,
      placedById: retailerUser.id,
      status: "DELIVERED",
      subtotal: deliveredBreakup.subtotal,
      gstAmount: deliveredBreakup.gstAmount,
      totalAmount: deliveredBreakup.totalAmount,
      items: { create: deliveredItems },
      statusEvents: {
        create: [
          { status: "PLACED", actorId: retailerUser.id },
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
          codAmount: deliveredBreakup.totalAmount,
        },
      },
    },
  });
  void deliveredOrder;

  // A freshly placed order (active pipeline)
  const placedItems = [
    { productId: products[4].id, quantity: 5, price: products[4].price, gstRate: products[4].gstRate },
    { productId: products[6].id, quantity: 3, price: products[6].price, gstRate: products[6].gstRate },
  ];
  const placedBreakup = priceBreakup(placedItems);
  await prisma.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      retailerId: retailerUser2.retailerProfile!.id,
      placedById: retailerUser2.id,
      status: "PLACED",
      subtotal: placedBreakup.subtotal,
      gstAmount: placedBreakup.gstAmount,
      totalAmount: placedBreakup.totalAmount,
      items: { create: placedItems },
      statusEvents: { create: { status: "PLACED", actorId: retailerUser2.id } },
    },
  });

  console.log("Seed complete.");
  console.log("Admin login: admin / admin123");
  console.log("Sales agent login: 'Test agent' / 123456789");
  console.log("Delivery agent login: deliveryagent@gmail.com / 123456789");
  console.log("Demo retailer phone (for OTP login): 9876543210 or 9123456780");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
