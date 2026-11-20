import type { Tx } from "@/lib/db";
import { formatINR } from "@/lib/money";
import { shareToken } from "@/lib/invoice-api";
import { deliverySettings, FAIL_REASONS, slotLabel } from "@/lib/delivery-settings";
import { notifySettings } from "@/lib/engage-settings";
import { notify, retailerUserId, staffWith, tenantUrl } from "@/lib/notify";

/**
 * Business events → messages. Each takes the transaction it runs in and is
 * safe to run twice (every notify carries a key).
 */

const IST = 5.5 * 3600_000;
const istDate = (d: Date | null | undefined) =>
  d ? new Date(d.getTime() + IST).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }) : "";

async function orderFacts(tx: Tx, orderId: string) {
  return tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      totalAmount: true,
      deliveryDate: true,
      retailerId: true,
      retailer: { select: { outletName: true, userId: true } },
      delivery: {
        select: {
          failReason: true,
          failNote: true,
          trip: { select: { slot: true } },
          deliveryAgent: { select: { user: { select: { id: true, name: true, phone: true } } } },
        },
      },
    },
  });
}

/** A new order: the retailer's confirmation and the office's alert. */
export async function onOrderPlacedNotify(tx: Tx, tenantId: string, orderId: string) {
  const o = await orderFacts(tx, orderId);
  if (!o) return;
  const amount = formatINR(o.totalAmount);
  await notify(tx, tenantId, {
    event: "order.placed",
    to: [o.retailer.userId],
    key: `order.placed:${o.id}`,
    link: `/retailer/orders/${o.id}`,
    vars: { outlet: o.retailer.outletName, order: o.orderNumber, amount, date: istDate(o.deliveryDate) || "the next delivery day" },
  });
  await notify(tx, tenantId, {
    event: "staff.order",
    to: await staffWith(tx, "orders.manage"),
    key: `staff.order:${o.id}`,
    link: "/admin/orders",
    vars: { order: o.orderNumber, outlet: o.retailer.outletName, amount },
  });
}

/** Out for delivery, cancelled, or brought back undelivered. */
export async function onOrderStatusNotify(tx: Tx, tenantId: string, orderId: string, from: string, to: string) {
  const o = await orderFacts(tx, orderId);
  if (!o) return;
  if (to === "OUT_FOR_DELIVERY") {
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
    const driver = o.delivery?.deliveryAgent.user;
    await notify(tx, tenantId, {
      event: "order.dispatched",
      to: [o.retailer.userId],
      // One per dispatch: a redelivery after a failed attempt tells them again.
      key: `order.dispatched:${o.id}:${await tx.orderStatusEvent.count({ where: { orderId, status: "OUT_FOR_DELIVERY" } })}`,
      link: `/retailer/orders/${o.id}`,
      vars: {
        order: o.orderNumber,
        driver: driver?.name ?? "",
        driverPhone: driver?.phone ?? "",
        slot: o.delivery?.trip ? slotLabel(deliverySettings(t?.settings), o.delivery.trip.slot) : "today",
      },
    });
    await invoiceIssuedNotify(tx, tenantId, o.id);
  } else if (to === "CANCELLED") {
    const ev = await tx.orderStatusEvent.findFirst({ where: { orderId, status: "CANCELLED" }, orderBy: { createdAt: "desc" }, select: { note: true } });
    await notify(tx, tenantId, {
      event: "order.cancelled",
      to: [o.retailer.userId],
      key: `order.cancelled:${o.id}`,
      link: `/retailer/orders/${o.id}`,
      vars: { order: o.orderNumber, reason: ev?.note ?? "" },
    });
  } else if (from === "OUT_FOR_DELIVERY" && to === "PACKED") {
    const r = o.delivery?.failReason;
    const reason = r && r in FAIL_REASONS ? FAIL_REASONS[r as keyof typeof FAIL_REASONS] : (o.delivery?.failNote ?? "");
    await notify(tx, tenantId, {
      event: "order.not_delivered",
      to: [o.retailer.userId],
      key: `order.not_delivered:${o.id}:${await tx.orderStatusEvent.count({ where: { orderId, status: "OUT_FOR_DELIVERY" } })}`,
      link: `/retailer/orders/${o.id}`,
      vars: { order: o.orderNumber, reason },
    });
  }
}

/** Delivered: tell the retailer (with the rating link) and send the invoice if not sent yet. */
export async function onOrderDeliveredNotify(tx: Tx, tenantId: string, orderId: string) {
  const o = await orderFacts(tx, orderId);
  if (!o) return;
  await notify(tx, tenantId, {
    event: "order.delivered",
    to: [o.retailer.userId],
    key: `order.delivered:${o.id}`,
    link: `/retailer/orders/${o.id}?rate=1`,
    vars: { order: o.orderNumber, amount: formatINR(o.totalAmount) },
  });
  await invoiceIssuedNotify(tx, tenantId, o.id);
}

/** The order's sale invoice, once, with its share link (and PDF on WhatsApp). */
export async function invoiceIssuedNotify(tx: Tx, tenantId: string, orderId: string) {
  const inv = await tx.invoice.findFirst({
    where: { orderId, type: { in: ["TAX_INVOICE", "BILL_OF_SUPPLY"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, number: true, total: true, shareVersion: true, retailer: { select: { userId: true } } },
  });
  if (!inv) return;
  const token = shareToken(tenantId, inv.id, inv.shareVersion);
  await notify(tx, tenantId, {
    event: "invoice.issued",
    to: [inv.retailer.userId],
    key: `invoice.issued:${inv.id}`,
    link: `/retailer/invoices/${inv.id}`,
    docUrl: await tenantUrl(tx, tenantId, `/api/public/invoices/${token}`),
    vars: { invoice: inv.number, amount: formatINR(inv.total), link: await tenantUrl(tx, tenantId, `/i/${token}`) },
  });
}

const METHOD: Record<string, string> = { CASH: "cash", UPI: "UPI", CHEQUE: "cheque", BANK: "bank transfer", ONLINE: "online payment", WALLET: "wallet", CREDIT_NOTE: "credit note" };

/** A confirmed payment from the retailer (not wallet settlements or credit notes). */
export async function paymentReceivedNotify(tx: Tx, tenantId: string, paymentId: string) {
  const p = await tx.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, number: true, amount: true, method: true, state: true, retailerId: true, retailer: { select: { userId: true } } },
  });
  if (!p || p.state !== "CONFIRMED" || p.method === "WALLET" || p.method === "CREDIT_NOTE") return;
  const acc = await tx.ledgerAccount.findUnique({ where: { tenantId_code: { tenantId, code: `RECEIVABLE:${p.retailerId}` } }, select: { id: true } });
  const owed = acc ? Number((await tx.ledgerLine.aggregate({ where: { accountId: acc.id }, _sum: { amount: true } }))._sum.amount ?? 0) : 0;
  await notify(tx, tenantId, {
    event: "payment.received",
    to: [p.retailer.userId],
    key: `payment.received:${p.id}`,
    link: `/retailer/khata`,
    vars: { amount: formatINR(p.amount), method: METHOD[p.method] ?? p.method, receipt: p.number, balance: formatINR(Math.max(0, owed)) },
  });
}

// ───────────────────────────── reminders and statements ─────────────────────────────

const DAY = 24 * 3600_000;
const istDayNo = (d: Date) => Math.floor((d.getTime() + IST) / DAY);

/**
 * Daily (10:00 IST): each retailer whose OLDEST overdue bill is exactly one
 * of the reminder days past due gets one reminder for the whole overdue sum.
 */
export async function duesReminders(tx: Tx, tenantId: string, now = new Date()) {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const s = notifySettings(t?.settings);
  if (!s.reminders.on || !s.reminders.days.length) return 0;
  const bills = await tx.bill.findMany({
    where: { settled: false, dueDate: { lt: now } },
    select: { retailerId: true, dueDate: true, amount: true, paid: true },
  });
  const per = new Map<string, { oldest: Date; sum: number }>();
  for (const b of bills) {
    const left = b.amount - b.paid;
    if (left <= 0) continue;
    const cur = per.get(b.retailerId);
    if (!cur) per.set(b.retailerId, { oldest: b.dueDate, sum: left });
    else {
      cur.sum += left;
      if (b.dueDate < cur.oldest) cur.oldest = b.dueDate;
    }
  }
  const today = istDayNo(now);
  const payLink = await tenantUrl(tx, tenantId, "/retailer/khata");
  let n = 0;
  for (const [retailerId, v] of per) {
    const days = today - istDayNo(v.oldest);
    if (!s.reminders.days.includes(days)) continue;
    const r = await tx.retailerProfile.findUnique({ where: { id: retailerId }, select: { outletName: true, userId: true } });
    if (!r) continue;
    await notify(tx, tenantId, {
      event: "dues.reminder",
      to: [r.userId],
      key: `dues.reminder:${retailerId}:${today}`,
      link: "/retailer/khata",
      vars: { outlet: r.outletName, amount: formatINR(v.sum), days, link: payLink },
    });
    n++;
  }
  return n;
}

/** Statement message to one retailer (office button, or monthly on the 1st). */
export async function sendStatement(tx: Tx, tenantId: string, retailerId: string, key: string) {
  const r = await tx.retailerProfile.findUnique({ where: { id: retailerId }, select: { outletName: true, userId: true } });
  if (!r) return false;
  const acc = await tx.ledgerAccount.findUnique({ where: { tenantId_code: { tenantId, code: `RECEIVABLE:${retailerId}` } }, select: { id: true } });
  const owed = acc ? Number((await tx.ledgerLine.aggregate({ where: { accountId: acc.id }, _sum: { amount: true } }))._sum.amount ?? 0) : 0;
  const overdueBills = await tx.bill.findMany({ where: { retailerId, settled: false, dueDate: { lt: new Date() } }, select: { amount: true, paid: true } });
  const overdue = overdueBills.reduce((s, b) => s + Math.max(0, b.amount - b.paid), 0);
  const res = await notify(tx, tenantId, {
    event: "statement",
    to: [r.userId],
    key,
    link: "/retailer/khata",
    vars: { outlet: r.outletName, balance: formatINR(Math.max(0, owed)), overdue: formatINR(overdue), link: await tenantUrl(tx, tenantId, "/retailer/khata") },
  });
  return res.inApp > 0;
}

/** On the 1st: a statement to every retailer who owes something, if the business turned it on. */
export async function monthlyStatements(tx: Tx, tenantId: string, now = new Date()) {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  if (!notifySettings(t?.settings).monthlyStatement) return 0;
  const month = new Date(now.getTime() + IST).toISOString().slice(0, 7);
  const owing = await tx.bill.groupBy({ by: ["retailerId"], where: { settled: false }, _count: true });
  let n = 0;
  for (const b of owing) if (await sendStatement(tx, tenantId, b.retailerId, `statement:${b.retailerId}:${month}`)) n++;
  return n;
}

export { retailerUserId };
