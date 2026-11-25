/**
 * Credit tiers, against the real database: a soft limit below each shop's
 * credit limit (held for anyone who manages credit), the real limit behind
 * it (held for the owner only), and a limit per salesman on what their shops
 * owe. Everything is created fresh in the demo tenant; settings are restored.
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { recheckCreditAtDispatch, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { INVOICE_DEFAULTS } from "@/lib/invoice-settings";
import { MONEY_DEFAULTS, parseMoneySettings } from "@/lib/money-settings";

let T = "";
let adminId = "";
let areaId = "";
let original: unknown = null;
const run = Date.now().toString().slice(-6);
let n = 0;
const ids = { tea: "", cat: "" };

async function setMoney(over: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: T },
    data: {
      settings: {
        ...(t.settings as object),
        cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" },
        invoice: { ...INVOICE_DEFAULTS, city: "Mumbai", pinCode: "400093", issueAt: "dispatch" },
        money: { ...MONEY_DEFAULTS, holdOnOverdue: false, ...over },
      } as object,
    },
  });
}

async function newShop(extra: Record<string, unknown> = {}) {
  n++;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Tier test ${run}-${n}`,
      phone: `2${run}${String(n).padStart(3, "0")}`,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Tier test ${run}-${n}`, shopNumber: "7", complexName: "Test Market", pinCode: "400001", areaId, paymentMode: "POSTPAID", creditLimit: null, ...extra } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}
/** Place an order of `quantity` × ₹105 (₹100 + 5%). */
const place = (retailerId: string, quantity = 1) =>
  withMoney(T, adminId, (ctx) => placeOrder(ctx, { retailerId, placedById: adminId, items: [{ productId: ids.tea, quantity }] })).then((r) => r.order);
const orderRow = (id: string) => tenantDb(T).order.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  ids.cat = (await db.category.create({ data: { name: `Tier cat ${run}` } })).id;
  ids.tea = (await db.product.create({ data: { name: `Test TIER ${run}`, sku: `TIER-TEA-${run}`, categoryId: ids.cat, unit: "pc", price: 10000, mrp: 20000, gstRate: 5, hsnCode: "0902" } })).id;
});

afterAll(async () => {
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).product.updateMany({ where: { id: ids.tea }, data: { active: false } });
  }
});

describe("soft limit setting", () => {
  it("takes 50 to 99, or blank for off", () => {
    expect(parseMoneySettings({ softLimitPct: 80 })).toMatchObject({ softLimitPct: 80 });
    expect(parseMoneySettings({ softLimitPct: null })).toMatchObject({ softLimitPct: null });
    expect(parseMoneySettings({ softLimitPct: 40 })).toMatch(/softLimitPct/);
    expect(parseMoneySettings({ softLimitPct: 100 })).toMatch(/softLimitPct/);
  });
});

describe("soft and real credit limits", () => {
  it("under the soft limit: no hold; past it: held for credit managers; past the real limit: held for the owner", async () => {
    await setMoney({ softLimitPct: 80 });
    // Limit ₹1,000; soft limit ₹800.
    const ok = await place(await newShop({ creditLimit: 100000 }), 7); // ₹735
    expect(await orderRow(ok.id)).toMatchObject({ creditHold: false, creditHoldOwner: false });

    const soft = await place(await newShop({ creditLimit: 100000 }), 8); // ₹840
    const s = await orderRow(soft.id);
    expect(s).toMatchObject({ creditHold: true, creditHoldOwner: false });
    expect(s.creditHoldReason).toMatch(/Past 80% of the credit limit: ₹840\.00 of ₹1,000\.00/);

    const over = await place(await newShop({ creditLimit: 100000 }), 10); // ₹1,050
    const o = await orderRow(over.id);
    expect(o).toMatchObject({ creditHold: true, creditHoldOwner: true });
    expect(o.creditHoldReason).toMatch(/Over credit limit by ₹50\.00.*only the owner/);
  });

  it("without a soft limit, past the limit is held as before, for anyone who manages credit", async () => {
    await setMoney({});
    const over = await place(await newShop({ creditLimit: 100000 }), 10);
    const o = await orderRow(over.id);
    expect(o).toMatchObject({ creditHold: true, creditHoldOwner: false });
    expect(o.creditHoldReason).not.toMatch(/owner/);
  });

  it("past the real limit wins over a smaller reason, so the owner decides", async () => {
    await setMoney({ softLimitPct: 80, defaultCreditBills: 1 });
    const shop = await newShop({ creditLimit: 100000 });
    // An unpaid bill already, by an opening bill.
    await tenantDb(T).bill.create({ data: { retailerId: shop, number: `TIER-OB-${run}`, date: new Date(), dueDate: new Date(), amount: 1000, kind: "OPENING" } });
    const o = await orderRow((await place(shop, 10)).id);
    expect(o).toMatchObject({ creditHold: true, creditHoldOwner: true });
  });

  it("the check when the order leaves keeps the owner-only mark", async () => {
    await setMoney({ softLimitPct: 80, checkCreditAtBilling: true });
    const shop = await newShop({ creditLimit: 100000 });
    const order = await place(shop, 7);
    expect((await orderRow(order.id)).creditHold).toBe(false);
    await tenantDb(T).retailerProfile.update({ where: { id: shop }, data: { creditLimit: 60000 } });
    await expect(withMoney(T, adminId, (ctx) => recheckCreditAtDispatch(ctx, order.id))).rejects.toThrow(/The owner must approve it/);
    expect(await orderRow(order.id)).toMatchObject({ creditHold: true, creditHoldOwner: true });
  });
});

describe("salesman limit", () => {
  it("holds a salesman's new orders once their shops would owe more than the limit", async () => {
    await setMoney({});
    const db = tenantDb(T);
    const agent = await db.user.create({
      data: { name: `Tier salesman ${run}`, loginId: `tier-sm-${run}`, passwordHash: "x", role: "SALES_AGENT", salesAgentProfile: { create: { creditLimit: 50000 } } },
      include: { salesAgentProfile: true },
    });
    const a = await newShop({ salesAgentId: agent.salesAgentProfile!.id });
    const b = await newShop({ salesAgentId: agent.salesAgentProfile!.id });
    const first = await place(a, 4); // ₹420 of ₹500
    expect(await orderRow(first.id)).toMatchObject({ creditHold: false, salesmanId: agent.id });
    const second = await orderRow((await place(b, 1)).id); // ₹525 with the open order
    expect(second).toMatchObject({ creditHold: true, creditHoldOwner: false });
    expect(second.creditHoldReason).toMatch(new RegExp(`Salesman Tier salesman ${run}'s shops would owe ₹525\\.00 \\(salesman's limit ₹500\\.00\\)`));

    // No limit: no hold.
    await db.salesAgentProfile.update({ where: { id: agent.salesAgentProfile!.id }, data: { creditLimit: null } });
    expect((await orderRow((await place(b, 1)).id)).creditHold).toBe(false);
  });
});
