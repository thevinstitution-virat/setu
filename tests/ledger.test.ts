/**
 * Money engine (Phase 1) against the real database. Each run creates fresh
 * retailers in the demo tenant (ledger rows are append-only, so nothing is
 * cleaned up; `npm run db:seed` resets everything).
 */
import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import {
  ageBills,
  cashInHand,
  chequeAction,
  MoneyError,
  onOrderCancelled,
  onOrderDelivered,
  onOrderPlaced,
  openingBalance,
  post,
  recordHandover,
  recordPayment,
  retailerBalances,
  reversePayment,
  verifyPayment,
  withMoney,
  writeOffShortage,
  type Ctx,
} from "@/lib/ledger";
import { nextOrderNumber } from "@/lib/orders";
import { validateBalances, parseIndianDate } from "@/lib/importers";

let T = "";
let adminId = "";
let driverId = "";
let areaId = "";
let secondId = "";
const run = Date.now().toString().slice(-6);
let n = 0;

const money = <R>(fn: (ctx: Ctx) => Promise<R>, actor = adminId) => withMoney(T, actor, fn);

async function newRetailer(terms: { paymentMode?: "PREPAID" | "POSTPAID"; creditLimit?: number; creditDays?: number } = {}) {
  n++;
  const phone = `7${run}${String(n).padStart(3, "0")}`;
  const u = await tenantDb(T).user.create({
    data: {
      name: `Ledger test ${run}-${n}`,
      phone,
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Ledger test ${run}-${n}`, shopNumber: "1", complexName: "T", pinCode: "400001", areaId, ...terms } },
    },
    include: { retailerProfile: true },
  });
  return u.retailerProfile!.id;
}

let productId = "";

/** A one-line order whose line adds up, so it can be invoiced (Phase 3) when delivered. */
async function newOrder(ctx: Ctx, retailerId: string, subtotal: number, gst = 0) {
  return ctx.tx.order.create({
    data: {
      orderNumber: await nextOrderNumber(ctx.tx, T),
      retailerId,
      placedById: adminId,
      subtotal,
      gstAmount: gst,
      totalAmount: subtotal + gst,
      items: { create: { productId, quantity: 1, price: subtotal, gstRate: gst ? Math.round((gst * 100) / subtotal) : 0 } },
    },
  });
}

async function placeAndDeliver(retailerId: string, subtotal: number, gst = 0) {
  return money(async (ctx) => {
    const o = await newOrder(ctx, retailerId, subtotal, gst);
    await onOrderPlaced(ctx, o);
    const fresh = await ctx.tx.order.findUniqueOrThrow({ where: { id: o.id } });
    await onOrderDelivered(ctx, fresh, null);
    return fresh;
  });
}

const bal = (retailerId: string) => money((ctx) => retailerBalances(ctx, retailerId));

/** Ledger receivable must equal open bill amounts minus confirmed dues payments not yet used. */
async function invariant(retailerId: string) {
  const db = tenantDb(T);
  const { receivable } = await bal(retailerId);
  const bills = await db.bill.aggregate({ where: { retailerId }, _sum: { amount: true } });
  const pays = await db.payment.aggregate({ where: { retailerId, purpose: "DUES", state: "CONFIRMED" }, _sum: { amount: true } });
  expect(receivable).toBe(Number(bills._sum.amount ?? 0) - Number(pays._sum.amount ?? 0));
  const open = await db.bill.findMany({ where: { retailerId } });
  for (const b of open) {
    const alloc = await db.paymentAllocation.aggregate({ where: { billId: b.id }, _sum: { amount: true } });
    expect(Number(alloc._sum.amount ?? 0)).toBe(b.paid);
    expect(b.settled).toBe(b.paid === b.amount);
  }
}

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } });
  const second = await prisma.tenant.findUniqueOrThrow({ where: { slug: "second" } });
  T = demo.id;
  secondId = second.id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  driverId = (await db.user.findFirstOrThrow({ where: { role: "DELIVERY_AGENT" } })).id;
  areaId = (await db.area.findFirstOrThrow()).id;
  productId = (await db.product.findFirstOrThrow({ orderBy: { sku: "asc" } })).id;
});

afterAll(() => prisma.$disconnect());

describe("ledger safeguards", () => {
  it("refuses an unbalanced entry in code", async () => {
    await expect(
      money((ctx) =>
        post(ctx, { kind: "PAYMENT", lines: [{ account: { type: "BANK" }, amount: 100 }, { account: { type: "OFFICE_CASH" }, amount: -99 }] })
      )
    ).rejects.toThrow(/Unbalanced/);
  });

  it("the database refuses an unbalanced entry even if code is bypassed", async () => {
    const acc = await money(async (ctx) => {
      await post(ctx, { kind: "PAYMENT", lines: [{ account: { type: "BANK" }, amount: 1 }, { account: { type: "OFFICE_CASH" }, amount: -1 }] });
      return ctx.tx.ledgerAccount.findFirstOrThrow({ where: { code: "BANK" } });
    });
    await expect(
      withTenantTx(T, (tx) =>
        tx.journalEntry.create({ data: { kind: "PAYMENT", lines: { create: [{ accountId: acc.id, amount: 500 }] } } })
      )
    ).rejects.toThrow(/unbalanced|at least|balanced/i);
  });

  it("ledger lines and entries cannot be changed or deleted", async () => {
    const line = await tenantDb(T).ledgerLine.findFirstOrThrow();
    const upd = await tenantDb(T).ledgerLine.updateMany({ where: { id: line.id }, data: { amount: 1 } });
    expect(upd.count).toBe(0);
    const del = await tenantDb(T).journalEntry.deleteMany({ where: { id: line.entryId } });
    expect(del.count).toBe(0);
    const still = await tenantDb(T).ledgerLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(still.amount).toBe(line.amount);
  });

  it("another tenant sees none of this tenant's ledger", async () => {
    expect(await tenantDb(secondId).ledgerLine.count({ where: { tenantId: T } })).toBe(0);
    expect(await tenantDb(secondId).payment.count({ where: { tenantId: T } })).toBe(0);
  });
});

describe("postpaid sales, payments and FIFO", () => {
  it("bills each delivery and allocates payments oldest first", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID", creditDays: 7 });
    await placeAndDeliver(r, 100_000, 18_000); // ₹1,180
    await placeAndDeliver(r, 50_000); // ₹500
    expect((await bal(r)).receivable).toBe(168_000);

    await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 130_000, method: "BANK", reference: "NEFT1", atOffice: true }));
    const bills = await tenantDb(T).bill.findMany({ where: { retailerId: r }, orderBy: { date: "asc" } });
    expect(bills.map((b) => [b.paid, b.settled])).toEqual([
      [118_000, true],
      [12_000, false],
    ]);
    expect((await bal(r)).receivable).toBe(38_000);
    await invariant(r);
  });

  it("a payment taken against an order goes to that order's bill first", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID" });
    await placeAndDeliver(r, 20_000);
    const second = await placeAndDeliver(r, 30_000);
    await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 30_000, method: "CASH", orderId: second.id, collectorId: driverId }));
    const b2 = await tenantDb(T).bill.findUniqueOrThrow({ where: { orderId: second.id } });
    expect(b2.settled).toBe(true);
    await invariant(r);
  });

  it("overpayment is held as advance and pays the next bill", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID" });
    await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 10_000, method: "UPI", reference: "UTR123456", atOffice: true }));
    expect((await bal(r)).receivable).toBe(-10_000);
    await placeAndDeliver(r, 25_000);
    const bill = await tenantDb(T).bill.findFirstOrThrow({ where: { retailerId: r } });
    expect(bill.paid).toBe(10_000);
    await invariant(r);
  });

  it("a reported UPI payment counts only after it is verified", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID" });
    await placeAndDeliver(r, 40_000);
    const p = await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 40_000, method: "UPI", reference: "UTR999", needsVerification: true, collectorId: null }));
    expect(p.state).toBe("PENDING_VERIFICATION");
    expect((await bal(r)).receivable).toBe(40_000);
    await money((ctx) => verifyPayment(ctx, p.id, true));
    expect((await bal(r)).receivable).toBe(0);
    await expect(money((ctx) => verifyPayment(ctx, p.id, true))).rejects.toThrow(MoneyError);
    await invariant(r);
  });

  it("reversing a payment brings the dues back", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID" });
    await placeAndDeliver(r, 15_000);
    const p = await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 15_000, method: "BANK", atOffice: true }));
    await money((ctx) => reversePayment(ctx, p.id, "entered twice"));
    expect((await bal(r)).receivable).toBe(15_000);
    await expect(money((ctx) => reversePayment(ctx, p.id, "again"))).rejects.toThrow(MoneyError);
    await invariant(r);
  });

  it("opening balance: owed creates a bill, advance creates a credit; only once", async () => {
    const r1 = await newRetailer();
    await money((ctx) => openingBalance(ctx, r1, 75_000, new Date("2026-04-01T00:00:00+05:30")));
    expect((await bal(r1)).receivable).toBe(75_000);
    await expect(money((ctx) => openingBalance(ctx, r1, 1_000, new Date()))).rejects.toThrow(/already/);
    await invariant(r1);

    const r2 = await newRetailer();
    await money((ctx) => openingBalance(ctx, r2, -20_000, new Date()));
    expect((await bal(r2)).receivable).toBe(-20_000);
    await placeAndDeliver(r2, 5_000);
    expect((await tenantDb(T).bill.findFirstOrThrow({ where: { retailerId: r2, kind: "ORDER" } })).settled).toBe(true);
    await invariant(r2);
  });
});

describe("cheques", () => {
  it("clear moves money to bank; bounce restores dues and charges the penalty", async () => {
    const before = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } }));
    const settings = (before.settings ?? {}) as Record<string, unknown>;
    await asPlatform((tx) =>
      tx.tenant.update({ where: { id: T }, data: { settings: { ...settings, money: { ...((settings.money as object) ?? {}), chequeBouncePenalty: 50_000 } } } })
    );
    try {
      const r = await newRetailer({ paymentMode: "POSTPAID" });
      await placeAndDeliver(r, 60_000);
      const cheque = { number: "123456", bank: "SBI", date: new Date() };
      const p = await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 60_000, method: "CHEQUE", cheque, collectorId: driverId }));
      expect((await bal(r)).receivable).toBe(0);
      await expect(money((ctx) => chequeAction(ctx, p.cheque!.id, "bounce"))).rejects.toThrow(/Deposit/);
      await money((ctx) => chequeAction(ctx, p.cheque!.id, "deposit"));
      await money((ctx) => chequeAction(ctx, p.cheque!.id, "bounce", "Insufficient funds"));
      expect((await bal(r)).receivable).toBe(110_000);
      const penalty = await tenantDb(T).bill.findFirstOrThrow({ where: { retailerId: r, kind: "PENALTY" } });
      expect(penalty.amount).toBe(50_000);
      expect((await tenantDb(T).payment.findUniqueOrThrow({ where: { id: p.id } })).state).toBe("REVERSED");
      await invariant(r);

      const p2 = await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 110_000, method: "CHEQUE", cheque: { ...cheque, number: "654321" }, atOffice: true }));
      await money((ctx) => chequeAction(ctx, p2.cheque!.id, "deposit"));
      await money((ctx) => chequeAction(ctx, p2.cheque!.id, "clear"));
      expect((await bal(r)).receivable).toBe(0);
      await invariant(r);
    } finally {
      await asPlatform((tx) => tx.tenant.update({ where: { id: T }, data: { settings: before.settings ?? {} } }));
    }
  });
});

describe("prepaid wallet", () => {
  it("reserves on order, refuses when short, releases on cancel, settles on delivery", async () => {
    const r = await newRetailer({ paymentMode: "PREPAID" });
    await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 100_000, method: "UPI", purpose: "WALLET", reference: "UTRW1", atOffice: true }));
    expect(await bal(r)).toMatchObject({ walletAvailable: 100_000, walletReserved: 0, receivable: 0 });

    const o1 = await money(async (ctx) => {
      const o = await newOrder(ctx, r, 60_000);
      await onOrderPlaced(ctx, o);
      return ctx.tx.order.findUniqueOrThrow({ where: { id: o.id } });
    });
    expect(o1.walletHold).toBe(60_000);
    expect(await bal(r)).toMatchObject({ walletAvailable: 40_000, walletReserved: 60_000 });

    // Too little left: the whole order is refused (rolled back).
    const countBefore = await tenantDb(T).order.count({ where: { retailerId: r } });
    await expect(
      money(async (ctx) => {
        const o = await newOrder(ctx, r, 50_000);
        await onOrderPlaced(ctx, o);
      })
    ).rejects.toMatchObject({ status: 402 });
    expect(await tenantDb(T).order.count({ where: { retailerId: r } })).toBe(countBefore);

    await money((ctx) => onOrderCancelled(ctx, o1));
    expect(await bal(r)).toMatchObject({ walletAvailable: 100_000, walletReserved: 0 });

    const o2 = await placeAndDeliver(r, 70_000);
    expect(await bal(r)).toMatchObject({ walletAvailable: 30_000, walletReserved: 0, receivable: 0 });
    expect((await tenantDb(T).bill.findUniqueOrThrow({ where: { orderId: o2.id } })).settled).toBe(true);
    expect((await tenantDb(T).order.findUniqueOrThrow({ where: { id: o2.id } })).walletHold).toBe(0);
    await invariant(r);
  });

  it("can't spend more than the wallet holds", async () => {
    const r = await newRetailer({ paymentMode: "PREPAID" });
    await expect(money((ctx) => recordPayment(ctx, { retailerId: r, amount: 1_000, method: "WALLET" }))).rejects.toThrow(/Wallet has only/);
  });
});

describe("credit control", () => {
  it("holds an order that crosses the credit limit", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID", creditLimit: 100_000 });
    await placeAndDeliver(r, 80_000);
    const held = await money(async (ctx) => {
      const o = await newOrder(ctx, r, 30_000);
      return onOrderPlaced(ctx, o);
    });
    expect(held.hold).toBe(true);
    expect(held.reason).toMatch(/credit limit/);
  });

  it("holds an order when a bill is overdue", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID", creditDays: 0 });
    await money((ctx) => openingBalance(ctx, r, 5_000, new Date(Date.now() - 3 * 86_400_000)));
    const held = await money(async (ctx) => onOrderPlaced(ctx, await newOrder(ctx, r, 1_000)));
    expect(held.hold).toBe(true);
    expect(held.reason).toMatch(/Overdue/);
  });

  it("no hold within limit and nothing overdue", async () => {
    const r = await newRetailer({ paymentMode: "POSTPAID", creditLimit: 100_000 });
    const res = await money(async (ctx) => onOrderPlaced(ctx, await newOrder(ctx, r, 90_000)));
    expect(res.hold).toBe(false);
  });
});

describe("staff cash", () => {
  it("tracks cash in hand, handover variance and write-off", async () => {
    const start = await money((ctx) => cashInHand(ctx, driverId));
    const r = await newRetailer({ paymentMode: "POSTPAID" });
    await placeAndDeliver(r, 50_000);
    await money((ctx) => recordPayment(ctx, { retailerId: r, amount: 50_000, method: "CASH", collectorId: driverId }), driverId);
    expect(await money((ctx) => cashInHand(ctx, driverId))).toBe(start + 50_000);

    await expect(money((ctx) => recordHandover(ctx, { staffUserId: driverId, counted: start + 60_000 }))).rejects.toThrow(/more than/);
    const h = await money((ctx) => recordHandover(ctx, { staffUserId: driverId, counted: start + 45_000 }));
    expect(h.expected).toBe(start + 50_000);
    expect(h.variance).toBe(5_000);
    expect(await money((ctx) => cashInHand(ctx, driverId))).toBe(5_000);

    await money((ctx) => writeOffShortage(ctx, driverId, 5_000, "Counted short, accepted"));
    expect(await money((ctx) => cashInHand(ctx, driverId))).toBe(0);
  });
});

describe("ageing and opening-balance import", () => {
  it("puts unpaid amounts in IST age buckets", () => {
    const today = new Date("2026-11-19T10:00:00+05:30");
    const d = (s: string) => new Date(`${s}T00:30:00+05:30`);
    expect(
      ageBills(
        [
          { date: d("2026-11-19"), amount: 100, paid: 0 },
          { date: d("2026-11-11"), amount: 200, paid: 50 },
          { date: d("2026-10-20"), amount: 300, paid: 0 },
          { date: d("2026-10-01"), amount: 400, paid: 400 },
          { date: d("2026-09-01"), amount: 500, paid: 0 },
        ],
        today
      )
    ).toEqual({ d0_7: 100, d8_15: 150, d16_30: 300, d30p: 500 });
  });

  it("validates balance rows", () => {
    expect(parseIndianDate("31/03/2026")?.toISOString()).toBe("2026-03-30T18:30:00.000Z");
    expect(parseIndianDate("31/02/2026")).toBeNull();
    const { valid, errors } = validateBalances(
      [
        { phone: "9876543210", amount: "1,250.50", as_of: "2026-03-31", note: "" },
        { phone: "98765", amount: "10" },
        { phone: "9123456780", amount: "-500" },
        { phone: "9123456781", amount: "0" },
        { phone: "9123456782", amount: "10", as_of: "2099-01-01" },
      ],
      new Date("2026-11-19T00:00:00Z")
    );
    expect(valid.map((v) => [v.phone, v.amount])).toEqual([
      ["9876543210", 125_050],
      ["9123456780", -50_000],
    ]);
    expect(errors.map((e) => e.row)).toEqual([3, 5, 6]);
  });
});
