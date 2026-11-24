/**
 * Outstanding and collection reports (the dealer's daily printouts):
 *  - bills:       every open bill, oldest first;
 *  - parties:     each shop with its open bills, the last receipt and what was
 *                 collected on each bill so far;
 *  - agents:      salesman → shop → bills, with subtotals and unused advances;
 *  - collections: what each shop paid in a date range, split by how it paid.
 *
 * "As on" a past date: bills dated up to that day, less only the money that
 * had come in by then. Allocation is oldest-bill-first (lib/ledger.ts), so a
 * bill's history matches what the shop's khata shows today.
 *
 * No writes here. Every query runs inside the tenant's RLS transaction.
 */
import type { Prisma } from "@/generated/prisma/client";
import { withTenantTx, type Tx } from "@/lib/db";
import { isDay, istDay, istDayRange } from "@/lib/field-math";
import { MoneyError } from "@/lib/money-error";
import { makePeriod, type Period } from "@/lib/report-periods";

export const DUES_VIEWS = ["bills", "parties", "agents", "collections"] as const;
export type DuesView = (typeof DUES_VIEWS)[number];
export const isDuesView = (v: unknown): v is DuesView => typeof v === "string" && (DUES_VIEWS as readonly string[]).includes(v);

export const DUES_TITLE: Record<DuesView, string> = {
  bills: "Outstanding bills, old to new",
  parties: "Outstanding party-wise, with collections",
  agents: "Outstanding salesman-wise",
  collections: "Collection summary, party-wise",
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type DuesFilters = {
  /** IST day; bills up to and including it. Default today. */
  asOn: string;
  areaId?: string;
  /** User id of the salesman (the bill's own salesman, else the shop's agent). */
  salesmanId?: string;
  beatId?: string;
  /** 0 = Sunday … 6 = Saturday: shops on a beat that runs that day. */
  weekday?: number;
};

/** Reads ?asOn=&areaId=&salesmanId=&beatId=&weekday= (bad values are dropped, a bad date fails). */
export function parseDuesFilters(sp: URLSearchParams, now = new Date()): DuesFilters {
  const today = istDay(now);
  const raw = sp.get("asOn");
  if (raw && !isDay(raw)) throw new MoneyError("Pick the date");
  const asOn = raw && raw < today ? raw : today;
  const id = (k: string) => {
    const v = sp.get(k);
    return v && /^[a-z0-9]{8,40}$/i.test(v) ? v : undefined;
  };
  const wd = sp.get("weekday");
  return {
    asOn,
    areaId: id("areaId"),
    salesmanId: id("salesmanId"),
    beatId: id("beatId"),
    weekday: wd !== null && /^[0-6]$/.test(wd) ? Number(wd) : undefined,
  };
}

export type Shop = {
  id: string;
  outletName: string;
  area: string;
  address: string;
  phone: string | null;
  altPhone: string | null;
  contactName: string | null;
  ownerName: string;
  /** User id + name of the shop's own sales agent. */
  agent: { id: string; name: string } | null;
};

export type Collection = { date: Date; amount: number; method: string; number: string };

/** Received in the old book before the bill was imported. */
export const EARLIER = "EARLIER";

export type DueBill = {
  id: string;
  number: string;
  kind: string;
  date: Date;
  dueDate: Date;
  amount: number;
  /** Received on this bill by the as-on day. */
  received: number;
  balance: number;
  /** Days from the bill date to the as-on day. */
  age: number;
  /** Days past the due date (0 when not due yet). */
  overdueDays: number;
  shop: Shop;
  salesman: { id: string; name: string } | null;
  collections: Collection[];
};

/** Which shops the filters leave in (area, salesman's shops, beat, beat day). */
function shopWhere(f: Omit<DuesFilters, "asOn">): Prisma.RetailerProfileWhereInput {
  const and: Prisma.RetailerProfileWhereInput[] = [];
  if (f.areaId) and.push({ areaId: f.areaId });
  if (f.beatId) and.push({ beats: { some: { beatId: f.beatId } } });
  if (f.weekday !== undefined) and.push({ beats: { some: { beat: { active: true, weekdays: { has: f.weekday } } } } });
  return and.length ? { AND: and } : {};
}

const SHOP_SELECT = {
  id: true,
  outletName: true,
  shopNumber: true,
  complexName: true,
  contactName: true,
  altPhone: true,
  salesAgentId: true,
  user: { select: { name: true, phone: true } },
  area: { select: { name: true } },
  salesAgent: { select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.RetailerProfileSelect;

type ShopRow = Prisma.RetailerProfileGetPayload<{ select: typeof SHOP_SELECT }>;

function toShop(r: ShopRow): Shop {
  return {
    id: r.id,
    outletName: r.outletName,
    area: r.area.name,
    address: [r.shopNumber, r.complexName].filter((s) => s && s !== "-").join(", "),
    phone: r.user.phone,
    altPhone: r.altPhone,
    contactName: r.contactName,
    ownerName: r.user.name,
    agent: r.salesAgent ? { id: r.salesAgent.user.id, name: r.salesAgent.user.name } : null,
  };
}

const dayNo = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/**
 * Open bills as on f.asOn, oldest first, with what was received on each and
 * the shop's unused advance (money paid by then that no bill of then used).
 */
export async function dueBills(tx: Tx, f: DuesFilters) {
  const end = istDayRange(f.asOn).to;
  const asOnNo = dayNo(f.asOn);
  const shopFilter = shopWhere(f);

  const rows = await tx.bill.findMany({
    where: {
      date: { lt: end },
      retailer: shopFilter,
      // Open now, or paid off only after the as-on day.
      OR: [{ settled: false }, { allocations: { some: { payment: { collectedAt: { gte: end } } } } }],
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      number: true,
      kind: true,
      date: true,
      dueDate: true,
      amount: true,
      paid: true,
      salesmanId: true,
      retailer: { select: SHOP_SELECT },
      allocations: { select: { amount: true, payment: { select: { collectedAt: true, method: true, number: true } } } },
    },
  });

  const salesmenIds = [...new Set(rows.map((b) => b.salesmanId).filter((x): x is string => !!x))];
  const users = salesmenIds.length ? await tx.user.findMany({ where: { id: { in: salesmenIds } }, select: { id: true, name: true } }) : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const shops = new Map<string, Shop>();
  const bills: DueBill[] = [];
  for (const b of rows) {
    // An imported bill comes with what the old book had already received on it
    // (in `paid`, with no allocation behind it); that counts on every date.
    const allocated = b.allocations.reduce((s, a) => s + a.amount, 0);
    const earlier = Math.max(0, b.paid - allocated);
    const byThen = b.allocations.filter((a) => a.payment.collectedAt < end);
    const received = earlier + byThen.reduce((s, a) => s + a.amount, 0);
    const balance = b.amount - received;
    if (balance <= 0) continue;
    const shop = shops.get(b.retailer.id) ?? toShop(b.retailer);
    shops.set(shop.id, shop);
    const salesman = b.salesmanId ? { id: b.salesmanId, name: userName.get(b.salesmanId) ?? "" } : shop.agent;
    if (f.salesmanId && salesman?.id !== f.salesmanId) continue;
    const age = asOnNo - dayNo(istDay(b.date));
    bills.push({
      id: b.id,
      number: b.number,
      kind: b.kind,
      date: b.date,
      dueDate: b.dueDate,
      amount: b.amount,
      received,
      balance,
      age: Math.max(0, age),
      overdueDays: Math.max(0, asOnNo - dayNo(istDay(b.dueDate))),
      shop,
      salesman,
      collections: [
        ...(earlier ? [{ date: b.date, amount: earlier, method: EARLIER, number: "" }] : []),
        ...byThen
          .map((a) => ({ date: a.payment.collectedAt, amount: a.amount, method: a.payment.method, number: a.payment.number }))
          .sort((x, y) => x.date.getTime() - y.date.getTime()),
      ],
    });
  }

  const ids = [...new Set(bills.map((b) => b.shop.id))];
  const [advances, lastReceipts] = ids.length ? await Promise.all([advancesAsOn(tx, ids, end), lastReceiptsAsOn(tx, ids, end)]) : [new Map(), new Map()];
  return { asOn: f.asOn, bills, advances: advances as Map<string, number>, lastReceipts: lastReceipts as Map<string, LastReceipt> };
}

/** Money paid by `end` that no bill dated before `end` has used: the shop's advance then. */
async function advancesAsOn(tx: Tx, retailerIds: string[], end: Date): Promise<Map<string, number>> {
  const rows = await tx.$queryRaw<{ retailerId: string; advance: bigint }[]>`
    SELECT p."retailerId", (SUM(p.amount) - COALESCE(SUM(u.used), 0))::bigint AS advance
    FROM "Payment" p
    LEFT JOIN (
      SELECT a."paymentId", SUM(a.amount) AS used
      FROM "PaymentAllocation" a JOIN "Bill" b ON b.id = a."billId"
      WHERE b.date < ${end}
      GROUP BY a."paymentId"
    ) u ON u."paymentId" = p.id
    WHERE p.purpose = 'DUES' AND p.state = 'CONFIRMED' AND p."collectedAt" < ${end}
      AND p."retailerId" = ANY(${retailerIds})
    GROUP BY p."retailerId"`;
  return new Map(rows.filter((r) => Number(r.advance) > 0).map((r) => [r.retailerId, Number(r.advance)]));
}

export type LastReceipt = { date: Date; amount: number; method: string };

/** Money that came in (not credit notes or wallet use). */
const RECEIPT_METHODS = ["CASH", "UPI", "CHEQUE", "BANK", "ONLINE"] as const;

async function lastReceiptsAsOn(tx: Tx, retailerIds: string[], end: Date): Promise<Map<string, LastReceipt>> {
  const rows = await tx.payment.findMany({
    where: { retailerId: { in: retailerIds }, purpose: "DUES", state: "CONFIRMED", method: { in: [...RECEIPT_METHODS] }, collectedAt: { lt: end } },
    orderBy: [{ retailerId: "asc" }, { collectedAt: "desc" }],
    distinct: ["retailerId"],
    select: { retailerId: true, collectedAt: true, amount: true, method: true },
  });
  return new Map(rows.map((r) => [r.retailerId, { date: r.collectedAt, amount: r.amount, method: r.method }]));
}

// ───────────────────────────── the three outstanding views ─────────────────────────────

const sum = (bills: { amount: number; received: number; balance: number }[]) =>
  bills.reduce((t, b) => ({ amount: t.amount + b.amount, received: t.received + b.received, balance: t.balance + b.balance }), { amount: 0, received: 0, balance: 0 });

export type Totals = ReturnType<typeof sum>;

export type PartyBlock = {
  shop: Shop;
  bills: DueBill[];
  totals: Totals;
  advance: number;
  /** Balance less the advance not yet used (what the shop really owes). */
  net: number;
  lastReceipt: (LastReceipt & { daysAgo: number }) | null;
};

function parties(d: Awaited<ReturnType<typeof dueBills>>): PartyBlock[] {
  const by = new Map<string, DueBill[]>();
  for (const b of d.bills) by.set(b.shop.id, [...(by.get(b.shop.id) ?? []), b]);
  const asOnNo = dayNo(d.asOn);
  return [...by.values()]
    .map((bills) => {
      const shop = bills[0].shop;
      const totals = sum(bills);
      const advance = d.advances.get(shop.id) ?? 0;
      const lr = d.lastReceipts.get(shop.id);
      return { shop, bills, totals, advance, net: totals.balance - advance, lastReceipt: lr ? { ...lr, daysAgo: asOnNo - dayNo(istDay(lr.date)) } : null };
    })
    .sort((a, b) => a.shop.area.localeCompare(b.shop.area) || a.shop.outletName.localeCompare(b.shop.outletName));
}

export type AgentBlock = { salesman: { id: string; name: string } | null; parties: PartyBlock[]; totals: Totals; advance: number };

function agents(d: Awaited<ReturnType<typeof dueBills>>): AgentBlock[] {
  const by = new Map<string, DueBill[]>();
  for (const b of d.bills) {
    const k = b.salesman?.id ?? "";
    by.set(k, [...(by.get(k) ?? []), b]);
  }
  return [...by.values()]
    .map((bills) => {
      const ps = parties({ ...d, bills });
      return { salesman: bills[0].salesman, parties: ps, totals: sum(bills), advance: ps.reduce((s, p) => s + p.advance, 0) };
    })
    .sort((a, b) => (!a.salesman ? 1 : !b.salesman ? -1 : a.salesman.name.localeCompare(b.salesman.name)));
}

// ───────────────────────────── collections ─────────────────────────────

export const COLLECTION_METHODS = ["CASH", "CHEQUE", "UPI", "BANK", "ONLINE"] as const;
export type CollectionMethod = (typeof COLLECTION_METHODS)[number];
export const METHOD_LABEL: Record<string, string> = { CASH: "Cash", CHEQUE: "Cheque", UPI: "UPI", BANK: "Bank", ONLINE: "Online", CREDIT_NOTE: "Credit note", WALLET: "Wallet" };

export type CollectionRow = { shop: Shop; count: number; total: number; byMethod: Record<CollectionMethod, number>; collectors: string[] };

/**
 * Money each shop paid in the period, by method. Confirmed payments only
 * (UPI/bank still waiting for a check are counted apart). A bounced cheque is
 * reversed and drops out.
 */
export async function collectionSummary(tx: Tx, p: Period, f: Omit<DuesFilters, "asOn">) {
  const shopFilter = shopWhere(f);
  const where: Prisma.PaymentWhereInput = {
    collectedAt: { gte: p.start, lt: p.end },
    method: { in: [...COLLECTION_METHODS] },
    retailer: f.salesmanId ? { AND: [shopFilter, { salesAgent: { userId: f.salesmanId } }] } : shopFilter,
  };
  const [rows, pending] = await Promise.all([
    tx.payment.findMany({
      where: { ...where, state: "CONFIRMED" },
      select: { amount: true, method: true, retailer: { select: SHOP_SELECT }, collectedBy: { select: { name: true } } },
    }),
    tx.payment.aggregate({ where: { ...where, state: "PENDING_VERIFICATION" }, _sum: { amount: true }, _count: true }),
  ]);
  const zero = (): Record<CollectionMethod, number> => ({ CASH: 0, CHEQUE: 0, UPI: 0, BANK: 0, ONLINE: 0 });
  const by = new Map<string, CollectionRow>();
  for (const r of rows) {
    const row = by.get(r.retailer.id) ?? { shop: toShop(r.retailer), count: 0, total: 0, byMethod: zero(), collectors: [] };
    row.count++;
    row.total += r.amount;
    row.byMethod[r.method as CollectionMethod] += r.amount;
    const who = r.collectedBy?.name;
    if (who && !row.collectors.includes(who)) row.collectors.push(who);
    by.set(r.retailer.id, row);
  }
  const list = [...by.values()].sort((a, b) => a.shop.area.localeCompare(b.shop.area) || a.shop.outletName.localeCompare(b.shop.outletName));
  const totals = list.reduce(
    (t, r) => {
      t.total += r.total;
      t.count += r.count;
      for (const m of COLLECTION_METHODS) t.byMethod[m] += r.byMethod[m];
      return t;
    },
    { total: 0, count: 0, byMethod: zero() }
  );
  return { rows: list, totals, pending: { count: pending._count, amount: pending._sum.amount ?? 0 } };
}

// ───────────────────────────── one entry point ─────────────────────────────

export type DuesReport =
  | { view: "bills"; asOn: string; bills: DueBill[]; totals: Totals; shops: number }
  | { view: "parties"; asOn: string; parties: PartyBlock[]; totals: Totals; advance: number }
  | { view: "agents"; asOn: string; agents: AgentBlock[]; totals: Totals; advance: number }
  | ({ view: "collections"; period: Period } & Awaited<ReturnType<typeof collectionSummary>>);

/** The default collection period: the as-on day (a day's collection sheet). */
export function collectionPeriod(sp: URLSearchParams, now = new Date()): Period {
  const today = istDay(now);
  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) return makePeriod(from ?? "", to ?? "");
  return makePeriod(today, today);
}

export async function loadDues(tenantId: string, view: DuesView, sp: URLSearchParams, now = new Date()): Promise<DuesReport> {
  const f = parseDuesFilters(sp, now);
  return withTenantTx(tenantId, async (tx) => {
    if (view === "collections") {
      const period = collectionPeriod(sp, now);
      return { view, period, ...(await collectionSummary(tx, period, f)) };
    }
    const d = await dueBills(tx, f);
    const totals = sum(d.bills);
    if (view === "bills") return { view, asOn: d.asOn, bills: d.bills, totals, shops: new Set(d.bills.map((b) => b.shop.id)).size };
    if (view === "parties") {
      const ps = parties(d);
      return { view, asOn: d.asOn, parties: ps, totals, advance: ps.reduce((s, p) => s + p.advance, 0) };
    }
    const as = agents(d);
    return { view, asOn: d.asOn, agents: as, totals, advance: as.reduce((s, a) => s + a.advance, 0) };
  });
}

/** Names for the filter line: area, salesman, beat, day. */
export async function filterOptions(tenantId: string) {
  return withTenantTx(tenantId, async (tx) => {
    const [areas, salesmen, beats] = await Promise.all([
      tx.area.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.user.findMany({ where: { active: true, role: { in: ["SALES_AGENT", "SUPERVISOR"] } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      tx.beat.findMany({ where: { active: true }, select: { id: true, name: true, weekdays: true }, orderBy: { name: "asc" } }),
    ]);
    return { areas, salesmen, beats };
  });
}

/** "Area: Pahsa · Salesman: Ravi · Monday" for print headers. */
export function filterLine(f: Omit<DuesFilters, "asOn">, o: Awaited<ReturnType<typeof filterOptions>>) {
  const parts: string[] = [];
  if (f.areaId) parts.push(`Area: ${o.areas.find((a) => a.id === f.areaId)?.name ?? "?"}`);
  if (f.salesmanId) parts.push(`Salesman: ${o.salesmen.find((a) => a.id === f.salesmanId)?.name ?? "?"}`);
  if (f.beatId) parts.push(`Beat: ${o.beats.find((a) => a.id === f.beatId)?.name ?? "?"}`);
  if (f.weekday !== undefined) parts.push(`Beat day: ${WEEKDAYS[f.weekday]}`);
  return parts.join(" · ");
}

/** dd/mm/yy in IST, the way dealer reports print dates. */
export function shortDate(d: Date | string) {
  const day = typeof d === "string" ? d : istDay(d);
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(2, 4)}`;
}

/** "Coll. 18/11 5,311 · 19/11 30,000" */
export function historyText(c: Collection[], money: (p: number) => string) {
  return c.length ? `Coll. ${c.map((x) => `${x.method === EARLIER ? "earlier" : shortDate(x.date).slice(0, 5)} ${money(x.amount)}`).join(" · ")}` : "";
}

/** "1 bill", "3 bills". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
