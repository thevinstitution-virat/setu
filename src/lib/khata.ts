import type { SessionPayload } from "@/lib/auth";
import type { TenantDb } from "@/lib/db";
import { withTenantTx } from "@/lib/db";
import { can } from "@/lib/permissions";
import { ageBills, istDay, loadTerms, retailerBalances, type Ageing, type Ctx } from "@/lib/ledger";
import { moneySettings } from "@/lib/money-settings";

/** Read side of the money engine: what the khata screens show. */

export async function khataSummary(ctx: Ctx, retailerId: string) {
  const [{ terms, settings, retailer }, balances, openBills, payments, pending, postDated] = await Promise.all([
    loadTerms(ctx, retailerId),
    retailerBalances(ctx, retailerId),
    ctx.tx.bill.findMany({
      where: { retailerId, settled: false },
      orderBy: { date: "asc" },
      select: { id: true, number: true, kind: true, date: true, dueDate: true, amount: true, paid: true, orderId: true, note: true },
    }),
    ctx.tx.payment.findMany({
      where: { retailerId },
      orderBy: { collectedAt: "desc" },
      take: 30,
      include: { cheque: true, collectedBy: { select: { name: true, role: true } } },
    }),
    ctx.tx.payment.aggregate({
      where: { retailerId, state: "PENDING_VERIFICATION" },
      _sum: { amount: true },
      _count: true,
    }),
    // Post-dated cheques held: not in the balance yet.
    ctx.tx.payment.aggregate({
      where: { retailerId, state: "POST_DATED" },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  const now = new Date();
  const overdue = openBills.filter((b) => b.dueDate < now).reduce((s, b) => s + b.amount - b.paid, 0);
  const [profile, hasOpening] = await Promise.all([
    ctx.tx.retailerProfile.findUniqueOrThrow({
      where: { id: retailerId },
      select: { shopNumber: true, complexName: true, user: { select: { name: true, phone: true } }, area: { select: { name: true } } },
    }),
    ctx.tx.journalEntry.count({ where: { retailerId, kind: "OPENING", reversedBy: null } }),
  ]);
  // Same exposure the credit check uses: what they owe + orders not yet delivered.
  const openOrders = await ctx.tx.order.aggregate({
    // Orders invoiced at dispatch are already in the receivable, so leave them out.
    where: { retailerId, status: { notIn: ["DELIVERED", "CANCELLED"] }, invoices: { none: { type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } } } },
    _sum: { totalAmount: true },
  });
  const openOrderTotal = Number(openOrders._sum.totalAmount ?? 0);
  const unallocated = await ctx.tx.payment.aggregate({
    where: { retailerId, purpose: "DUES", state: "CONFIRMED" },
    _sum: { amount: true, allocated: true },
  });
  return {
    retailer: {
      id: retailer.id,
      outletName: retailer.outletName,
      ownerName: profile.user.name,
      phone: profile.user.phone,
      areaName: profile.area.name,
      address: [profile.shopNumber, profile.complexName].filter(Boolean).join(", "),
    },
    /** An opening balance can be entered only once. */
    hasOpening: hasOpening > 0,
    terms,
    termsOverride: {
      paymentMode: retailer.paymentMode,
      creditLimit: retailer.creditLimit,
      creditDays: retailer.creditDays,
      creditBills: retailer.creditBills,
      tempCreditLimit: retailer.tempCreditLimit,
      tempCreditUntil: retailer.tempCreditUntil,
      receiptsOnAccount: retailer.receiptsOnAccount,
    },
    balances,
    /** Credit left before new orders go on hold (null = no limit). */
    creditAvailable:
      terms.creditLimit === null ? null : Math.max(0, terms.creditLimit - balances.receivable - openOrderTotal),
    /** Orders placed but not delivered yet (not billed, but they use credit). */
    openOrderTotal,
    overdue,
    ageing: ageBills(openBills, now),
    /** Money paid in advance that no bill has used yet. */
    advance: Number(unallocated._sum.amount ?? 0) - Number(unallocated._sum.allocated ?? 0),
    pendingVerification: { amount: Number(pending._sum.amount ?? 0), count: pending._count },
    /** Post-dated cheques held: they pay nothing until they are banked on or after their date. */
    postDated: { amount: Number(postDated._sum.amount ?? 0), count: postDated._count },
    openBills: openBills.map((b) => ({ ...b, due: b.amount - b.paid, overdue: b.dueDate < now })),
    payments,
    upi: settings.upiVpa ? { vpa: settings.upiVpa, payee: settings.upiPayeeName } : null,
  };
}

export type KhataRow = {
  retailerId: string;
  outletName: string;
  ownerName: string;
  phone: string | null;
  areaName: string;
  salesAgentId: string | null;
  paymentMode: "PREPAID" | "POSTPAID";
  creditLimit: number | null;
  receivable: number;
  wallet: number;
  overdue: number;
  oldestDueDays: number | null;
  ageing: Ageing;
  lastPaymentAt: Date | null;
};

/** Every retailer with balances and ageing, for the admin khata list. */
export async function khataList(tenantId: string, opts: { salesAgentId?: string } = {}): Promise<KhataRow[]> {
  return withTenantTx(tenantId, async (tx) => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
    const s = moneySettings(tenant.settings);
    const retailers = await tx.retailerProfile.findMany({
      where: opts.salesAgentId ? { salesAgentId: opts.salesAgentId } : {},
      select: {
        id: true,
        outletName: true,
        salesAgentId: true,
        paymentMode: true,
        creditLimit: true,
        user: { select: { name: true, phone: true } },
        area: { select: { name: true } },
      },
      orderBy: { outletName: "asc" },
    });
    const sums = await tx.$queryRaw<{ retailerId: string; type: string; total: bigint }[]>`
      SELECT a."retailerId", a.type::text AS type, COALESCE(SUM(l.amount), 0)::bigint AS total
      FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id
      WHERE a."retailerId" IS NOT NULL AND a.type IN ('RECEIVABLE', 'WALLET')
      GROUP BY a."retailerId", a.type`;
    const bills = await tx.bill.findMany({
      where: { settled: false },
      select: { retailerId: true, date: true, dueDate: true, amount: true, paid: true },
    });
    const lastPay = await tx.payment.groupBy({
      by: ["retailerId"],
      where: { state: "CONFIRMED" },
      _max: { collectedAt: true },
    });

    const bal = new Map<string, { receivable: number; wallet: number }>();
    for (const r of sums) {
      const b = bal.get(r.retailerId) ?? { receivable: 0, wallet: 0 };
      if (r.type === "RECEIVABLE") b.receivable = Number(r.total);
      else b.wallet = 0 - Number(r.total);
      bal.set(r.retailerId, b);
    }
    const billsBy = new Map<string, typeof bills>();
    for (const b of bills) billsBy.set(b.retailerId, [...(billsBy.get(b.retailerId) ?? []), b]);
    const lastBy = new Map(lastPay.map((p) => [p.retailerId, p._max.collectedAt]));
    const now = new Date();

    return retailers.map((r) => {
      const rb = billsBy.get(r.id) ?? [];
      const overdueBills = rb.filter((b) => b.dueDate < now);
      const oldest = overdueBills.reduce<Date | null>((m, b) => (!m || b.dueDate < m ? b.dueDate : m), null);
      return {
        retailerId: r.id,
        outletName: r.outletName,
        ownerName: r.user.name,
        phone: r.user.phone,
        areaName: r.area.name,
        salesAgentId: r.salesAgentId,
        paymentMode: r.paymentMode ?? s.defaultPaymentMode,
        creditLimit: r.creditLimit ?? s.defaultCreditLimit,
        receivable: bal.get(r.id)?.receivable ?? 0,
        wallet: bal.get(r.id)?.wallet ?? 0,
        overdue: overdueBills.reduce((t, b) => t + b.amount - b.paid, 0),
        oldestDueDays: oldest ? istDay(now) - istDay(oldest) : null,
        ageing: ageBills(rb, now),
        lastPaymentAt: lastBy.get(r.id) ?? null,
      };
    });
  });
}

/**
 * May this user record a payment for this retailer? Admin/accounts: anyone.
 * Sales agent: retailers on their book. Delivery agent: retailers they have
 * a delivery for. Returns the retailer or null.
 */
export async function collectScope(db: TenantDb, session: SessionPayload, retailerId: string) {
  const retailer = await db.retailerProfile.findUnique({ where: { id: retailerId }, select: { id: true, salesAgentId: true, outletName: true } });
  if (!retailer) return null;
  if (can(session.role, "ledger.view")) return { retailer, office: true };
  if (session.role === "SALES_AGENT") {
    const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    return agent && retailer.salesAgentId === agent.id ? { retailer, office: false } : null;
  }
  if (session.role === "DELIVERY_AGENT") {
    const agent = await db.deliveryAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent) return null;
    const has = await db.delivery.findFirst({ where: { deliveryAgentId: agent.id, order: { retailerId } }, select: { id: true } });
    if (has) return { retailer, office: false };
    // Spot sales may go to any shop, so a driver who can spot-sell sees dues while on the road.
    if (can(session.role, "stock.spot_sell")) {
      const onRoad = await db.trip.findFirst({ where: { driverId: agent.id, status: "STARTED" }, select: { id: true } });
      if (onRoad) return { retailer, office: false };
    }
    return null;
  }
  return null;
}
