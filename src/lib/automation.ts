/**
 * The automation layer (roadmap §7), plain maths only: each automation reads
 * the business's own records and writes a Suggestion with its reasons. A
 * permitted person accepts or rejects it; accepting does the work (visit
 * tasks, a credit limit, trips). Nothing posts to the books, changes a price
 * or moves money by itself, and only the visit plan may apply itself.
 */
import type { Prisma, Role } from "@/generated/prisma/client";
import { asPlatform, withTenantTx } from "@/lib/db";
import { MoneyError, type Ctx } from "@/lib/ledger";
import { can, type Permission } from "@/lib/permissions";
import { addDay, istDay, istDayRange, weekday } from "@/lib/field-math";
import { churnRisk } from "@/lib/analytics";
import { beatForDay, teamScope } from "@/lib/field";
import { moneySettings, termsFor } from "@/lib/money-settings";
import { deliverySettings, slotLabel } from "@/lib/delivery-settings";
import { addOrders, autoSequence, createTrip, sequenceStops } from "@/lib/trips";
import { formatINR } from "@/lib/money";
import { automationSettings, type AutomationSettings } from "@/lib/automation-settings";
import { suggest, type NewSuggestion } from "@/lib/suggest";
import { applyReorder, reviewReorder } from "@/lib/forecast";
import { applyCatalogue, type CatalogueEdit } from "@/lib/catalogue-assist";
import { expireDrafts } from "@/lib/order-drafts";
import {
  ANOMALY_LABEL,
  CREDIT_BAND_LABEL,
  VISIT_REASON,
  creditScore,
  discountPct,
  isFar,
  orderRhythm,
  routeMetres,
  splitStops,
  usualOrder,
  visitScore,
  type AnomalyKind,
  type VisitReason,
} from "@/lib/automation-math";

type Tx = Ctx["tx"];
const DAY_MS = 86_400_000;
const rs = (p: number) => formatINR(p, { whole: true });
const limitText = (l: number | null) => (l === null ? "no limit" : rs(l));
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** The Monday (IST) of the week of `day`: one credit review per shop per week. */
const weekOf = (day: string) => addDay(day, -((weekday(day) + 6) % 7));
/** Whole IST days from a to b. */
const daysFrom = (a: Date, b: Date) => Math.round((Date.parse(istDay(b)) - Date.parse(istDay(a))) / DAY_MS);

// ---------- suggestions ----------

export const SUGGESTION_KINDS = ["visit_plan", "credit_limit", "credit_stop", "credit_restore", "check", "trip_plan", "reorder", "catalogue"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const isSuggestionKind = (v: unknown): v is SuggestionKind => typeof v === "string" && (SUGGESTION_KINDS as readonly string[]).includes(v);

export const KIND_LABEL: Record<SuggestionKind, string> = {
  visit_plan: "Visit plan",
  credit_limit: "Credit limit",
  credit_stop: "Stop credit",
  credit_restore: "Give credit back",
  check: "Check",
  trip_plan: "Trip plan",
  reorder: "Reorder",
  catalogue: "Catalogue",
};
/** Kinds with their own screen (Products → Catalogue assist), kept out of the inbox. */
export const OWN_SCREEN_KINDS: SuggestionKind[] = ["catalogue"];

/** Who may decide each kind: any one of the permissions (admins have every permission). */
export const KIND_PERMISSION: Record<SuggestionKind, Permission[]> = {
  visit_plan: ["team.manage", "team.supervise"],
  credit_limit: ["credit.manage"],
  credit_stop: ["credit.manage"],
  credit_restore: ["credit.manage"],
  check: ["reports.view"],
  trip_plan: ["orders.dispatch"],
  reorder: ["stock.manage"],
  catalogue: ["catalogue.manage"],
};

export type Who = { userId: string; role: Role };
const canAny = (role: Role, perms: Permission[]) => perms.some((p) => can(role, p));
export const kindsFor = (role: Role) => SUGGESTION_KINDS.filter((k) => canAny(role, KIND_PERMISSION[k]));

// ---------- shared reads ----------

type ShopMoney = { outstanding: number; overdue: number; maxOverdueDays: number; oldestBillId: string | null };

async function moneyByShop(tx: Tx, now: Date, retailerIds?: string[]) {
  const bills = await tx.bill.findMany({
    where: { settled: false, ...(retailerIds ? { retailerId: { in: retailerIds } } : {}) },
    select: { id: true, retailerId: true, dueDate: true, amount: true, paid: true },
    orderBy: { dueDate: "asc" },
  });
  const out = new Map<string, ShopMoney>();
  for (const b of bills) {
    const left = b.amount - b.paid;
    if (left <= 0) continue;
    const m = out.get(b.retailerId) ?? { outstanding: 0, overdue: 0, maxOverdueDays: 0, oldestBillId: null };
    m.outstanding += left;
    const late = daysFrom(b.dueDate, now);
    if (late > 0) {
      m.overdue += left;
      if (late > m.maxOverdueDays) [m.maxOverdueDays, m.oldestBillId] = [late, b.id];
    }
    out.set(b.retailerId, m);
  }
  return out;
}

async function rhythmByShop(tx: Tx, now: Date, retailerIds: string[]) {
  const orders = await tx.order.findMany({
    where: { retailerId: { in: retailerIds }, status: { not: "CANCELLED" }, createdAt: { gte: new Date(now.getTime() - 180 * DAY_MS), lte: now } },
    select: { retailerId: true, createdAt: true },
  });
  const dates = new Map<string, Date[]>();
  for (const o of orders) dates.set(o.retailerId, [...(dates.get(o.retailerId) ?? []), o.createdAt]);
  const out = new Map<string, ReturnType<typeof orderRhythm> & { risk: ReturnType<typeof churnRisk> }>();
  for (const id of retailerIds) {
    const r = orderRhythm(dates.get(id) ?? [], now);
    out.set(id, { ...r, risk: churnRisk(r.orders, r.usualGap, r.daysSince) });
  }
  return out;
}

// ---------- A7 (+ A4 visits): visit plan ----------

export type PlanShop = { retailerId: string; name: string; area: string; score: number; reasons: VisitReason[]; overdue: number; onRoute: boolean };

/**
 * For each active sales agent working on `date`: the shops worth a visit that
 * aren't on today's beat (top `maxShops` by score, at least `minScore`), plus
 * any shop (on the beat or not) whose money is `visitAfterDays` overdue, so
 * the agent collects. One suggestion per agent per day.
 */
export async function planVisits(ctx: Ctx, date: string, now: Date, s: AutomationSettings) {
  if (!s.visitPlan.on) return 0;
  const tx = ctx.tx;
  const agents = await tx.salesAgentProfile.findMany({ where: { user: { active: true } }, select: { id: true, userId: true, user: { select: { name: true } } } });
  if (!agents.length) return 0;
  const onLeave = new Set(
    (await tx.leaveRequest.findMany({ where: { status: "APPROVED", fromDate: { lte: date }, toDate: { gte: date } }, select: { userId: true } })).map((l) => l.userId)
  );
  const shops = await tx.retailerProfile.findMany({
    where: { salesAgentId: { in: agents.map((a) => a.id) }, user: { active: true } },
    select: { id: true, outletName: true, salesAgentId: true, areaId: true, area: { select: { name: true } } },
  });
  if (!shops.length) return 0;
  const ids = shops.map((x) => x.id);
  const [rhythm, money, recentVisits, schemes] = await Promise.all([
    rhythmByShop(tx, now, ids),
    moneyByShop(tx, now, ids),
    tx.visit.findMany({ where: { retailerId: { in: ids }, checkInAt: { gte: new Date(now.getTime() - 3 * DAY_MS) } }, select: { retailerId: true, checkInAt: true } }),
    tx.scheme.findMany({
      where: { active: true, couponCode: null, groupIds: { isEmpty: true }, endsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) } },
      select: { id: true, endsAt: true, areaIds: true, retailerIds: true },
    }),
  ]);
  const used = new Set(
    schemes.length
      ? (await tx.schemeRedemption.findMany({ where: { schemeId: { in: schemes.map((x) => x.id) }, reversed: false }, select: { schemeId: true, retailerId: true } })).map((r) => `${r.schemeId}:${r.retailerId}`)
      : []
  );
  const lastVisit = new Map<string, Date>();
  for (const v of recentVisits) if (!lastVisit.has(v.retailerId) || v.checkInAt > lastVisit.get(v.retailerId)!) lastVisit.set(v.retailerId, v.checkInAt);
  const today = istDay(now);

  let made = 0;
  for (const a of agents) {
    if (onLeave.has(a.userId)) continue;
    const day = await beatForDay(tx, ctx.tenantId, a.id, date);
    if (day.plan && !day.beat) continue; // a planned day with no beat: training, meeting
    const route = new Set(day.beat ? (await tx.beatRetailer.findMany({ where: { beatId: day.beat.id }, select: { retailerId: true } })).map((r) => r.retailerId) : []);
    const picks: (PlanShop & { forced: boolean })[] = [];
    for (const shop of shops.filter((x) => x.salesAgentId === a.id)) {
      const r = rhythm.get(shop.id)!;
      const m = money.get(shop.id);
      const schemeEndsIn = schemes
        .filter((sc) => !used.has(`${sc.id}:${shop.id}`) && (sc.retailerIds.includes(shop.id) || sc.areaIds.includes(shop.areaId) || (!sc.retailerIds.length && !sc.areaIds.length)))
        .map((sc) => daysFrom(now, sc.endsAt!))
        .sort((x, y) => x - y)[0];
      const v = visitScore({
        risk: r.risk,
        dueIn: r.dueIn,
        overdue: m?.overdue ?? 0,
        overdueDays: m?.maxOverdueDays ?? 0,
        schemeEndsIn: schemeEndsIn ?? null,
        visitedDaysAgo: lastVisit.has(shop.id) ? daysFrom(lastVisit.get(shop.id)!, now) : null,
        orderedToday: date === today && r.daysSince === 0,
      });
      const collect = s.collections.on && (m?.maxOverdueDays ?? 0) >= s.collections.visitAfterDays;
      const onRoute = route.has(shop.id);
      if (onRoute ? collect : collect || v.score >= s.visitPlan.minScore) {
        picks.push({ retailerId: shop.id, name: shop.outletName, area: shop.area.name, score: v.score, reasons: v.reasons.length ? v.reasons : ["overdue"], overdue: m?.overdue ?? 0, onRoute, forced: collect });
      }
    }
    const extra = picks
      .filter((p) => !p.onRoute)
      .sort((x, y) => Number(y.forced) - Number(x.forced) || y.score - x.score)
      .slice(0, s.visitPlan.maxShops);
    const list: PlanShop[] = [...picks.filter((p) => p.onRoute), ...extra].map((p) => ({ retailerId: p.retailerId, name: p.name, area: p.area, score: p.score, reasons: p.reasons, overdue: p.overdue, onRoute: p.onRoute }));
    if (!list.length) continue;
    const collectN = list.filter((p) => p.reasons.includes("overdue")).length;
    const created = await suggest(tx, {
      kind: "visit_plan",
      subjectType: "sales_agent",
      subjectId: a.id,
      title: extra.length
        ? `${a.user.name}: ${extra.length} extra shop${extra.length === 1 ? "" : "s"} to visit${collectN ? `, ${collectN} to collect from` : ""}`
        : `${a.user.name}: collect from ${collectN} shop${collectN === 1 ? "" : "s"} on the beat`,
      detail: `${dayLabel(date)}${day.beat ? `, on top of the ${day.beat.name} beat` : ", no beat that day"}.`,
      reasons: [...new Set(list.flatMap((p) => p.reasons))].map((r) => VISIT_REASON[r]),
      payload: { salesAgentId: a.id, date, shops: list } as unknown as Prisma.InputJsonValue,
      score: Math.max(...list.map((p) => p.score)),
      dedupeKey: `visit_plan:${a.id}:${date}`,
      forDate: date,
      expiresAt: istDayRange(date).to,
    });
    if (!created) continue;
    made++;
    if (s.visitPlan.auto) await applyAndClose(ctx, created.id, { auto: true });
  }
  return made;
}

// ---------- A4: stop and give back credit ----------

/**
 * Credit shops with a bill `stopAfterDays` late: suggest a ₹0 limit (orders
 * then go on credit hold until it pays). When such a shop has cleared what
 * was overdue, suggest giving the old limit back.
 */
export async function reviewCollections(ctx: Ctx, now: Date, s: AutomationSettings) {
  if (!s.collections.on) return 0;
  const tx = ctx.tx;
  const ms = moneySettings((await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } })).settings);
  const shops = await tx.retailerProfile.findMany({ where: { user: { active: true } }, select: { id: true, outletName: true, paymentMode: true, creditLimit: true, creditDays: true } });
  const money = await moneyByShop(tx, now);
  let made = 0;
  for (const r of shops) {
    const t = termsFor(ms, r);
    const m = money.get(r.id);
    if (t.mode !== "POSTPAID" || t.creditLimit === 0 || !m || m.maxOverdueDays < s.collections.stopAfterDays) continue;
    const ok = await suggest(tx, {
      kind: "credit_stop",
      subjectType: "retailer",
      subjectId: r.id,
      title: `Stop credit for ${r.outletName}`,
      detail: `${rs(m.overdue)} overdue; the oldest bill is ${m.maxOverdueDays} days late. Accepting sets its credit limit to ₹0, so new orders wait for approval until it pays. You can give the limit back later.`,
      reasons: [`${m.maxOverdueDays} days late (stop after ${s.collections.stopAfterDays})`, `limit now ${limitText(t.creditLimit)}`],
      payload: { retailerId: r.id, previous: r.creditLimit, effective: t.creditLimit, to: 0 },
      score: 50 + Math.min(50, m.maxOverdueDays - s.collections.stopAfterDays),
      dedupeKey: `credit_stop:${r.id}:${m.oldestBillId}`,
      expiresAt: new Date(now.getTime() + 14 * DAY_MS),
    });
    if (ok) made++;
  }
  const stops = await tx.suggestion.findMany({ where: { kind: "credit_stop", status: "ACCEPTED" }, select: { id: true, payload: true } });
  for (const st of stops) {
    const p = st.payload as { retailerId: string; previous: number | null; effective: number };
    const r = shops.find((x) => x.id === p.retailerId);
    if (!r || r.creditLimit !== 0 || (money.get(r.id)?.overdue ?? 0) > 0) continue;
    const ok = await suggest(tx, {
      kind: "credit_restore",
      subjectType: "retailer",
      subjectId: r.id,
      title: `Give ${r.outletName} its credit back`,
      detail: `Nothing is overdue now. Accepting sets its limit back to ${p.previous === null ? `the business default (${limitText(ms.defaultCreditLimit)})` : rs(p.previous)}.`,
      reasons: ["paid what was overdue"],
      payload: { retailerId: r.id, restoreTo: p.previous, stopId: st.id },
      score: 30,
      dedupeKey: `credit_restore:${st.id}`,
    });
    if (ok) made++;
  }
  return made;
}

// ---------- A12: weekly credit review ----------

/** Every credit shop's risk score; a limit change is suggested when the maths differs enough from today's limit. */
export async function reviewCredit(ctx: Ctx, now: Date, s: AutomationSettings) {
  if (!s.credit.on) return 0;
  const tx = ctx.tx;
  const ms = moneySettings((await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } })).settings);
  const shops = (await tx.retailerProfile.findMany({ where: { user: { active: true } }, select: { id: true, outletName: true, paymentMode: true, creditLimit: true, creditDays: true } }))
    .map((r) => ({ ...r, terms: termsFor(ms, r) }))
    .filter((r) => r.terms.mode === "POSTPAID" && r.terms.creditLimit !== 0);
  if (!shops.length) return 0;
  const ids = shops.map((r) => r.id);
  const since = new Date(now.getTime() - 90 * DAY_MS);
  const [money, rhythm, invoices, settled, bounced, openStops] = await Promise.all([
    moneyByShop(tx, now, ids),
    rhythmByShop(tx, now, ids),
    tx.invoice.groupBy({ by: ["retailerId", "type"], where: { retailerId: { in: ids }, date: { gte: since, lte: now } }, _sum: { total: true } }),
    tx.bill.findMany({
      where: { retailerId: { in: ids }, settled: true, date: { gte: since } },
      // When the money came in is the payment's collectedAt (an allocation's own time is when it was recorded).
      select: { retailerId: true, date: true, allocations: { select: { payment: { select: { collectedAt: true } } } } },
    }),
    tx.cheque.findMany({ where: { status: "BOUNCED", bouncedAt: { gte: since } }, select: { payment: { select: { retailerId: true } } } }),
    tx.suggestion.findMany({ where: { kind: "credit_stop", status: "OPEN" }, select: { subjectId: true } }),
  ]);
  const sales = new Map<string, number>();
  for (const i of invoices) {
    const sign = i.type === "CREDIT_NOTE" ? -1 : 1;
    sales.set(i.retailerId, (sales.get(i.retailerId) ?? 0) + sign * (i._sum.total ?? 0));
  }
  const pay = new Map<string, number[]>();
  for (const b of settled) {
    if (!b.allocations.length) continue;
    const last = new Date(Math.max(...b.allocations.map((x) => x.payment.collectedAt.getTime())));
    pay.set(b.retailerId, [...(pay.get(b.retailerId) ?? []), Math.max(0, daysFrom(b.date, last))]);
  }
  const bounces = new Map<string, number>();
  for (const c of bounced) bounces.set(c.payment.retailerId, (bounces.get(c.payment.retailerId) ?? 0) + 1);
  const stopped = new Set(openStops.map((x) => x.subjectId));
  const week = weekOf(istDay(now));

  let made = 0;
  for (const r of shops) {
    if (stopped.has(r.id)) continue;
    const m = money.get(r.id);
    const days = pay.get(r.id);
    const noLimit = r.terms.creditLimit === null;
    const limit = r.terms.creditLimit ?? Number.MAX_SAFE_INTEGER;
    const c = creditScore({
      limit,
      creditDays: r.terms.creditDays,
      outstanding: m?.outstanding ?? 0,
      overdue: m?.overdue ?? 0,
      maxOverdueDays: m?.maxOverdueDays ?? 0,
      avgPayDays: days?.length ? Math.round(days.reduce((x, y) => x + y, 0) / days.length) : null,
      bounces: bounces.get(r.id) ?? 0,
      monthlySales: Math.max(0, Math.round((sales.get(r.id) ?? 0) / 3)),
      risk: rhythm.get(r.id)!.risk,
    });
    // No limit today: suggest one only when the shop is not safe.
    if (c.suggestLimit === null || (noLimit && c.band === "low")) continue;
    const up = c.suggestLimit > limit;
    const ok = await suggest(tx, {
      kind: "credit_limit",
      subjectType: "retailer",
      subjectId: r.id,
      title: c.suggestLimit === 0 ? `Move ${r.outletName} to cash only` : noLimit ? `Set a credit limit of ${rs(c.suggestLimit)} for ${r.outletName}` : `${up ? "Raise" : "Lower"} ${r.outletName}'s credit limit to ${rs(c.suggestLimit)}`,
      detail:
        `Now ${limitText(r.terms.creditLimit)}. Risk score ${c.score} of 100 (${CREDIT_BAND_LABEL[c.band]}). Bought about ${rs(Math.round((sales.get(r.id) ?? 0) / 3))} a month over the last 3 months; credit days ${r.terms.creditDays}.` +
        ((m?.outstanding ?? 0) > c.suggestLimit ? ` It owes ${rs(m!.outstanding)} now, so its new orders will wait for approval until it pays below the new limit.` : ""),
      reasons: c.reasons,
      payload: { retailerId: r.id, previous: r.creditLimit, from: r.terms.creditLimit, to: c.suggestLimit, score: c.score, band: c.band },
      score: up ? 20 : Math.max(30, c.score),
      dedupeKey: `credit_limit:${r.id}:${week}`,
      expiresAt: new Date(now.getTime() + 7 * DAY_MS),
    });
    if (ok) made++;
  }
  return made;
}

// ---------- A9: checks ----------

/** Things on `day` (IST) that may be wrong: cash short, delivered far from the shop, shop closed again and again, a big discount. */
export async function runChecks(ctx: Ctx, day: string, s: AutomationSettings) {
  if (!s.checks.on) return 0;
  const tx = ctx.tx;
  const c = s.checks;
  const { from, to } = istDayRange(day);
  const expiresAt = new Date(to.getTime() + 14 * DAY_MS);
  const flag = (kind: AnomalyKind, x: Omit<NewSuggestion, "kind" | "expiresAt" | "title"> & { title: string }) =>
    suggest(tx, { ...x, kind: "check", title: `${ANOMALY_LABEL[kind]}: ${x.title}`, payload: { check: kind, ...(x.payload as object) }, expiresAt });
  let made = 0;

  const cash = await tx.cashHandover.findMany({ where: { createdAt: { gte: from, lt: to }, variance: { gte: Math.max(1, c.cashShort) } }, select: { id: true, expected: true, counted: true, variance: true, staff: { select: { name: true } } } });
  for (const h of cash) {
    if (
      await flag("cash_variance", {
        subjectType: "cash_handover",
        subjectId: h.id,
        title: `${h.staff.name} short by ${rs(h.variance)}`,
        detail: `Expected ${rs(h.expected)}, counted ${rs(h.counted)} on ${dayLabel(day)}.`,
        reasons: [`more than ${rs(c.cashShort)} short`],
        payload: { variance: h.variance },
        score: 40 + Math.min(50, Math.floor(h.variance / 50_000)),
        dedupeKey: `check:cash:${h.id}`,
      })
    )
      made++;
  }

  const delivered = await tx.delivery.findMany({
    where: { state: "DELIVERED", deliveredAt: { gte: from, lt: to }, lat: { not: null }, lng: { not: null } },
    select: { id: true, lat: true, lng: true, order: { select: { orderNumber: true, retailer: { select: { outletName: true, lat: true, lng: true } } } }, deliveryAgent: { select: { user: { select: { name: true } } } } },
  });
  for (const d of delivered) {
    const shop = d.order.retailer.lat !== null && d.order.retailer.lng !== null ? { lat: d.order.retailer.lat, lng: d.order.retailer.lng } : null;
    const at = { lat: d.lat!, lng: d.lng! };
    if (!isFar(at, shop, c.farMetres)) continue;
    const m = Math.round(Math.hypot((at.lat - shop!.lat) * 111_320, (at.lng - shop!.lng) * 111_320 * Math.cos((shop!.lat * Math.PI) / 180)));
    if (
      await flag("far_from_shop", {
        subjectType: "delivery",
        subjectId: d.id,
        title: `${d.order.orderNumber} to ${d.order.retailer.outletName}`,
        detail: `${d.deliveryAgent.user.name} marked it delivered about ${m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`} from the shop's pin on ${dayLabel(day)}. Either the pin is wrong or the goods went elsewhere.`,
        reasons: [`more than ${c.farMetres} m away`],
        payload: { metres: m },
        score: 30 + Math.min(40, Math.floor(m / 500)),
        dedupeKey: `check:far:${d.id}`,
      })
    )
      made++;
  }

  const monthAgo = new Date(to.getTime() - 30 * DAY_MS);
  const [failed, noOrder] = await Promise.all([
    tx.delivery.findMany({ where: { failReason: "shop_closed", failedAt: { gte: monthAgo, lt: to } }, select: { failedAt: true, order: { select: { retailerId: true } } } }),
    tx.visit.findMany({ where: { noOrderReason: "shop_closed", checkInAt: { gte: monthAgo, lt: to } }, select: { checkInAt: true, retailerId: true } }),
  ]);
  const closed = new Map<string, { n: number; today: boolean }>();
  for (const e of [...failed.map((f) => ({ id: f.order.retailerId, at: f.failedAt! })), ...noOrder.map((v) => ({ id: v.retailerId, at: v.checkInAt }))]) {
    const x = closed.get(e.id) ?? { n: 0, today: false };
    x.n++;
    if (e.at >= from) x.today = true;
    closed.set(e.id, x);
  }
  const closedIds = [...closed].filter(([, x]) => x.today && x.n >= c.closedTimes).map(([id]) => id);
  const names = new Map((await tx.retailerProfile.findMany({ where: { id: { in: closedIds } }, select: { id: true, outletName: true } })).map((r) => [r.id, r.outletName]));
  for (const id of closedIds) {
    const n = closed.get(id)!.n;
    if (
      await flag("shop_closed", {
        subjectType: "retailer",
        subjectId: id,
        title: `${names.get(id)} (${n} times in 30 days)`,
        detail: "Deliveries and visits found it closed again and again. Check the shop's hours, or whether it has shut, before sending more.",
        reasons: [`${n} times closed (flag at ${c.closedTimes})`],
        payload: { times: n },
        score: 25 + Math.min(40, n * 5),
        dedupeKey: `check:closed:${id}:${weekOf(day)}`,
      })
    )
      made++;
  }

  const orders = await tx.order.findMany({
    where: { createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" }, grossAmount: { gt: 0 }, discountAmount: { gt: 0 } },
    select: { id: true, orderNumber: true, grossAmount: true, discountAmount: true, couponCode: true, retailer: { select: { outletName: true } }, placedById: true },
  });
  for (const o of orders) {
    const pct = discountPct(o.grossAmount, o.grossAmount - o.discountAmount);
    if (pct < c.discountPct) continue;
    if (
      await flag("big_discount", {
        subjectType: "order",
        subjectId: o.id,
        title: `${o.orderNumber} for ${o.retailer.outletName}, ${pct}% off`,
        detail: `${rs(o.discountAmount)} off ${rs(o.grossAmount)}${o.couponCode ? ` (coupon ${o.couponCode})` : ""}. Schemes stacking more than expected, or a scheme set too generously.`,
        reasons: [`${pct}% off (flag at ${c.discountPct}%)`],
        payload: { pct, discount: o.discountAmount },
        score: 20 + Math.min(50, Math.round(pct)),
        dedupeKey: `check:discount:${o.id}`,
      })
    )
      made++;
  }
  return made;
}

// ---------- A5: trip plan ----------

export type PlannedTrip = { driverId: string; driverName: string; vehicleId: string | null; vehicleName: string | null; orderIds: string[]; drops: number; value: number; km: number | null; areas: string[] };

/**
 * Splits the orders ready for `date` (due that day or earlier, not on an open
 * trip: the dispatch board's list) across the drivers free in `slot`
 * (one side of town each, at most `maxDrops` a trip where drivers allow), in
 * route order, and proposes it. Accepting makes the trips.
 */
export async function planTrips(ctx: Ctx, p: { date: string; slot?: string }, now: Date, s: AutomationSettings) {
  if (!s.tripPlan.on) throw new MoneyError("Trip planning is turned off in Automation settings");
  const tx = ctx.tx;
  const ds = deliverySettings((await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } })).settings);
  const slot = p.slot ?? ds.slots[0].key;
  if (!ds.slots.some((x) => x.key === slot)) throw new MoneyError("Pick a slot");
  const orders = await tx.order.findMany({
    where: {
      status: { in: ["PLACED", "CONFIRMED", "PACKED"] },
      // The same orders as the dispatch board's "Ready to go".
      NOT: { AND: [{ creditHold: true }, { creditApprovedAt: null }] },
      AND: [
        { OR: [{ deliveryDate: null }, { deliveryDate: { lte: new Date(`${p.date}T00:00:00Z`) } }] },
        { OR: [{ delivery: null }, { delivery: { tripId: null } }, { delivery: { trip: { status: "CLOSED" } } }] },
      ],
    },
    select: { id: true, orderNumber: true, totalAmount: true, retailer: { select: { outletName: true, lat: true, lng: true, pinCode: true, area: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  if (!orders.length) throw new MoneyError(`No orders are ready for ${dayLabel(p.date)}`);
  const busy = await tx.trip.findMany({ where: { date: new Date(`${p.date}T00:00:00Z`), slot, status: { not: "CLOSED" } }, select: { driverId: true, vehicleId: true } });
  const onLeave = new Set((await tx.leaveRequest.findMany({ where: { status: "APPROVED", fromDate: { lte: p.date }, toDate: { gte: p.date } }, select: { userId: true } })).map((l) => l.userId));
  const drivers = (await tx.deliveryAgentProfile.findMany({ where: { user: { active: true } }, select: { id: true, userId: true, user: { select: { name: true } } } }))
    .filter((d) => !onLeave.has(d.userId) && !busy.some((b) => b.driverId === d.id))
    .sort((a, b) => a.user.name.localeCompare(b.user.name));
  if (!drivers.length) throw new MoneyError("No driver is free for that slot");
  const vehicles = (await tx.vehicle.findMany({ where: { active: true }, select: { id: true, name: true, number: true }, orderBy: { number: "asc" } })).filter((v) => !busy.some((b) => b.vehicleId === v.id));

  const k = Math.min(drivers.length, Math.max(1, Math.ceil(orders.length / s.tripPlan.maxDrops)));
  const stops = orders.map((o) => ({ id: o.id, lat: o.retailer.lat, lng: o.retailer.lng, area: o.retailer.area.name, pinCode: o.retailer.pinCode, name: o.retailer.outletName, value: o.totalAmount }));
  const groups = splitStops(stops, ds.depot, k);
  const trips: PlannedTrip[] = groups.map((g, i) => {
    const seq = sequenceStops(g, ds.depot);
    const located = seq.filter((x) => x.lat !== null && x.lng !== null).map((x) => ({ lat: x.lat!, lng: x.lng! }));
    return {
      driverId: drivers[i].id,
      driverName: drivers[i].user.name,
      vehicleId: vehicles[i]?.id ?? null,
      vehicleName: vehicles[i] ? vehicles[i].name || vehicles[i].number : null,
      orderIds: seq.map((x) => x.id),
      drops: seq.length,
      value: g.reduce((a, x) => a + x.value, 0),
      km: located.length ? Math.round(routeMetres(located, ds.depot) / 100) / 10 : null,
      areas: [...new Set(g.map((x) => x.area))],
    };
  });
  const over = orders.length > drivers.length * s.tripPlan.maxDrops;
  // A new plan replaces an older open one for the same day and slot.
  await tx.suggestion.updateMany({ where: { kind: "trip_plan", status: "OPEN", subjectId: `${p.date}:${slot}` }, data: { status: "EXPIRED" } });
  return suggest(tx, {
    kind: "trip_plan",
    subjectType: "day",
    subjectId: `${p.date}:${slot}`,
    title: `${orders.length} order${orders.length === 1 ? "" : "s"} in ${trips.length} trip${trips.length === 1 ? "" : "s"} for ${dayLabel(p.date)}, ${slotLabel(ds, slot)}`,
    detail: `${drivers.length} driver${drivers.length === 1 ? "" : "s"} free; at most ${s.tripPlan.maxDrops} drops a trip. Each trip covers one side of town, in route order${ds.depot ? " from the warehouse" : ""}.`,
    reasons: [...(over ? [`more orders than ${drivers.length} drivers × ${s.tripPlan.maxDrops} drops: trips are bigger`] : []), ...(stops.some((x) => x.lat === null) ? ["shops without a map pin go with their area"] : [])],
    payload: { date: p.date, slot, trips } as unknown as Prisma.InputJsonValue,
    score: 50,
    dedupeKey: `trip_plan:${p.date}:${slot}:${now.getTime()}`,
    forDate: p.date,
    expiresAt: istDayRange(p.date).to,
  });
}

// ---------- deciding ----------

export type AuditNote = { action: string; entity: string; entityId: string; before?: unknown; after?: unknown };

async function canDecide(tx: Tx, who: Who, s: { kind: string; payload: unknown }) {
  if (!isSuggestionKind(s.kind) || !canAny(who.role, KIND_PERMISSION[s.kind])) return false;
  if (s.kind !== "visit_plan") return true;
  const scope = await teamScope(tx, who);
  if (scope === null) return true;
  const agent = await tx.salesAgentProfile.findUnique({ where: { id: (s.payload as { salesAgentId: string }).salesAgentId }, select: { userId: true } });
  return !!agent && scope.includes(agent.userId);
}

/**
 * Accept or reject an open suggestion. Accepting applies it in the same
 * transaction; `retailerIds` picks which shops of a visit plan to keep.
 * Returns the audit notes for the caller to write.
 */
export async function decide(ctx: Ctx, who: Who, id: string, d: { accept: boolean; note?: string; retailerIds?: string[]; edit?: CatalogueEdit }, now = new Date()) {
  const s = await ctx.tx.suggestion.findUnique({ where: { id } });
  if (!s) throw new MoneyError("Suggestion not found", 404);
  if (!(await canDecide(ctx.tx, who, s))) throw new MoneyError("You can't decide this one", 403);
  if (s.status !== "OPEN") throw new MoneyError(`Already ${s.status.toLowerCase()}`, 409);
  if (s.expiresAt && s.expiresAt <= now) {
    await ctx.tx.suggestion.update({ where: { id }, data: { status: "EXPIRED" } });
    throw new MoneyError("This suggestion has expired", 409);
  }
  const note = d.note?.trim().slice(0, 500) || null;
  if (!d.accept) {
    await ctx.tx.suggestion.update({ where: { id }, data: { status: "REJECTED", decidedById: who.userId, decidedAt: now, note } });
    return { status: "REJECTED" as const, audits: [] as AuditNote[] };
  }
  return applyAndClose(ctx, id, { who, note, retailerIds: d.retailerIds, edit: d.edit, now });
}

async function applyAndClose(ctx: Ctx, id: string, o: { who?: Who; note?: string | null; retailerIds?: string[]; edit?: CatalogueEdit; auto?: boolean; now?: Date }) {
  const tx = ctx.tx;
  const s = await tx.suggestion.findUniqueOrThrow({ where: { id } });
  const p = s.payload as Record<string, unknown>;
  const audits: AuditNote[] = [];
  let result: Prisma.InputJsonValue = {};

  if (s.kind === "visit_plan") {
    const shops = (p.shops as PlanShop[]).filter((x) => !o.retailerIds || o.retailerIds.includes(x.retailerId));
    if (!shops.length) throw new MoneyError("Keep at least one shop, or reject the plan");
    const made = await tx.visitTask.createMany({
      data: shops.map((x) => ({ salesAgentId: p.salesAgentId as string, retailerId: x.retailerId, date: p.date as string, reasons: x.reasons, source: "visit_plan", suggestionId: s.id, createdById: o.who?.userId ?? null })),
      skipDuplicates: true,
    });
    result = { tasks: made.count, kept: shops.map((x) => x.retailerId) };
  } else if (s.kind === "credit_limit" || s.kind === "credit_stop" || s.kind === "credit_restore") {
    const r = await tx.retailerProfile.findUnique({ where: { id: p.retailerId as string }, select: { id: true, creditLimit: true, outletName: true } });
    if (!r) throw new MoneyError("Shop not found", 404);
    const expected = s.kind === "credit_restore" ? 0 : (p.previous as number | null);
    if (r.creditLimit !== expected) throw new MoneyError(`${r.outletName}'s limit has changed since this was suggested. Reject it; the next review uses the new limit.`, 409);
    const to = s.kind === "credit_restore" ? (p.restoreTo as number | null) : (p.to as number);
    await tx.retailerProfile.update({ where: { id: r.id }, data: { creditLimit: to } });
    audits.push({ action: "retailer.terms", entity: "RetailerProfile", entityId: r.id, before: { creditLimit: r.creditLimit }, after: { creditLimit: to, suggestionId: s.id } });
    result = { creditLimit: to };
  } else if (s.kind === "trip_plan") {
    const made: { id: string; number: string }[] = [];
    for (const t of p.trips as PlannedTrip[]) {
      const trip = await createTrip(ctx, { date: p.date as string, slot: p.slot as string, driverId: t.driverId, vehicleId: t.vehicleId }, o.now);
      await addOrders(ctx, trip.id, t.orderIds);
      await autoSequence(ctx, trip.id);
      made.push({ id: trip.id, number: trip.number });
      audits.push({ action: "trip.create", entity: "Trip", entityId: trip.id, after: { orders: t.orderIds.length, suggestionId: s.id } });
    }
    result = { trips: made };
  } else if (s.kind === "reorder") {
    const r = await applyReorder(ctx, p, o.now ?? new Date());
    audits.push({ action: "po.create", entity: "PurchaseOrder", entityId: r.poId, after: { number: r.number, lines: r.lines, suggestionId: s.id } });
    result = r;
  } else if (s.kind === "catalogue") {
    const r = await applyCatalogue(ctx, p, o.edit);
    audits.push({ action: "product.update", entity: "Product", entityId: r.productId, before: r.before, after: { ...r.after, suggestionId: s.id } });
    result = r.after as Prisma.InputJsonValue;
  }
  // "check": accepting means "looked into it"; nothing to apply.

  await tx.suggestion.update({
    where: { id },
    data: { status: "ACCEPTED", decidedById: o.who?.userId ?? null, decidedAt: o.now ?? new Date(), note: o.note ?? (o.auto ? "Applied by the auto rule" : null), auto: !!o.auto, result },
  });
  audits.push({ action: "suggestion.accept", entity: "Suggestion", entityId: id, after: { kind: s.kind, auto: !!o.auto } });
  return { status: "ACCEPTED" as const, result, audits };
}

/**
 * The inbox: suggestions this person may decide, newest first (open ones by
 * priority). A supervisor sees visit plans for their own team only.
 */
export async function listSuggestions(tx: Tx, who: Who, f: { status?: "OPEN" | "ACCEPTED" | "REJECTED" | "EXPIRED"; kind?: SuggestionKind; take?: number } = {}) {
  const inboxKinds = kindsFor(who.role).filter((k) => !OWN_SCREEN_KINDS.includes(k));
  const kinds = f.kind ? kindsFor(who.role).filter((k) => k === f.kind) : inboxKinds;
  if (!kinds.length) return { items: [], counts: {} as Record<string, number> };
  const scope = await teamScope(tx, who);
  const agentIds = scope === null ? null : (await tx.salesAgentProfile.findMany({ where: { userId: { in: scope } }, select: { id: true } })).map((a) => a.id);
  const visible = (k: SuggestionKind): Prisma.SuggestionWhereInput => (k === "visit_plan" && agentIds ? { kind: k, subjectId: { in: agentIds } } : { kind: k });
  const status = f.status ?? "OPEN";
  const [items, open] = await Promise.all([
    tx.suggestion.findMany({
      where: { status, OR: kinds.map(visible) },
      orderBy: status === "OPEN" ? [{ score: "desc" }, { createdAt: "desc" }] : [{ decidedAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(f.take ?? 100, 200),
    }),
    tx.suggestion.groupBy({ by: ["kind"], where: { status: "OPEN", OR: (f.kind ? kinds : inboxKinds).map(visible) }, _count: { _all: true } }),
  ]);
  const deciders = await tx.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.decidedById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const nameOf = new Map(deciders.map((u) => [u.id, u.name]));
  return {
    items: items.map((i) => ({ ...i, decidedBy: i.decidedById ? (nameOf.get(i.decidedById) ?? null) : null })),
    counts: Object.fromEntries(open.map((o) => [o.kind, o._count._all])) as Record<string, number>,
  };
}

// ---------- running ----------

export type Feature = "visit_plan" | "collections" | "checks" | "credit" | "reorder" | "expire";

/** Runs one automation for one business in its own transaction and logs it (AutomationRun). Errors are logged, not thrown. */
export async function runFeature(tenantId: string, feature: Feature, trigger: "schedule" | "manual", now = new Date()) {
  const run = await withTenantTx(tenantId, (tx) => tx.automationRun.create({ data: { feature, trigger, startedAt: now } }));
  try {
    const made = await withTenantTx(
      tenantId,
      async (tx) => {
        const ctx: Ctx = { tx, tenantId, actorId: null };
        const s = automationSettings((await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } })).settings);
        const day = istDay(now);
        if (feature === "visit_plan") return planVisits(ctx, day, now, s);
        if (feature === "collections") return reviewCollections(ctx, now, s);
        if (feature === "checks") return runChecks(ctx, addDay(day, -1), s);
        if (feature === "credit") return reviewCredit(ctx, now, s);
        if (feature === "reorder") return reviewReorder(ctx, now, s);
        const old = (await tx.suggestion.updateMany({ where: { status: "OPEN", expiresAt: { lte: now } }, data: { status: "EXPIRED" } })).count;
        return old + (await expireDrafts(tx, now));
      },
      { timeout: 120_000 }
    );
    await withTenantTx(tenantId, (tx) => tx.automationRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), made } }));
    return { feature, made };
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 500) : String(e);
    await withTenantTx(tenantId, (tx) => tx.automationRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), error } }));
    console.error(`[automation] ${feature} ${tenantId}`, e);
    return { feature, made: 0, error };
  }
}

export const DAILY: Feature[] = ["expire", "visit_plan", "collections", "checks", "reorder"];

/** Every live business: the daily set (06:00 IST), plus the credit review on Mondays. */
export async function runAutomations(now = new Date(), opts: { weekly?: boolean } = {}) {
  const ids = (await asPlatform((tx) => tx.tenant.findMany({ where: { status: { in: ["TRIAL", "ACTIVE"] } }, select: { id: true } }))).map((t) => t.id);
  let made = 0;
  for (const id of ids) {
    for (const f of opts.weekly ? (["credit"] as Feature[]) : DAILY) made += (await runFeature(id, f, "schedule", now)).made;
  }
  return { tenants: ids.length, made };
}

// ---------- A2: usual order ----------

/** A shop's usual order (products it buys most times, at the usual quantity), for the "Usual order" button. */
export async function usualOrderFor(tx: Tx, retailerId: string, now = new Date()) {
  const orders = await tx.order.findMany({
    where: { retailerId, status: { not: "CANCELLED" }, createdAt: { gte: new Date(now.getTime() - 120 * DAY_MS) } },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { createdAt: true, items: { select: { productId: true, orderedQty: true, quantity: true } } },
  });
  return usualOrder(
    orders.map((o) => ({ at: o.createdAt, lines: o.items.map((i) => ({ productId: i.productId, qty: i.orderedQty ?? i.quantity })) })),
    now
  );
}

// ---------- AI cost log ----------

/** Moved to lib/ai.ts with the AI gateway (Phase 12). */
export { recordAiUse } from "@/lib/ai";
