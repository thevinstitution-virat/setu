/**
 * The maths behind the automations (roadmap §7: A2, A5, A7, A9, A12).
 * Plain functions, no database and no AI: every number a suggestion shows
 * comes from here, so it can be tested and explained line by line.
 */
import { metres } from "@/lib/field-math";

const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;

export type ChurnRisk = "none" | "new" | "low" | "medium" | "high";

// ---------- A2: usual order and rhythm ----------

export const USUAL = { orders: 8, days: 120, share: 0.5 } as const;

export type PastOrder = {
  at: Date;
  lines: { productId: string; qty: number }[];
};
export type UsualLine = {
  productId: string;
  qty: number;
  times: number;
  of: number;
};

/**
 * A shop's usual order: the products in at least half of its last 8 orders
 * (last 120 days, and at least two orders), each at its median quantity.
 * Fewer than two orders → nothing (no pattern yet).
 */
export function usualOrder(orders: PastOrder[], now: Date, opts: { orders?: number; days?: number; share?: number } = {}): { lines: UsualLine[]; basedOn: number } {
  const take = opts.orders ?? USUAL.orders;
  const since = now.getTime() - (opts.days ?? USUAL.days) * DAY_MS;
  const recent = orders
    .filter((o) => o.at.getTime() >= since && o.at.getTime() <= now.getTime())
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, take);
  const n = recent.length;
  if (n < 2) return { lines: [], basedOn: n };
  const seen = new Map<string, number[]>();
  for (const o of recent) {
    const perOrder = new Map<string, number>();
    for (const l of o.lines) if (l.qty > 0) perOrder.set(l.productId, (perOrder.get(l.productId) ?? 0) + l.qty);
    for (const [p, q] of perOrder) seen.set(p, [...(seen.get(p) ?? []), q]);
  }
  const share = opts.share ?? USUAL.share;
  const lines: UsualLine[] = [];
  for (const [productId, qtys] of seen) {
    if (qtys.length < 2 || qtys.length / n < share) continue;
    lines.push({
      productId,
      qty: Math.max(1, median(qtys)),
      times: qtys.length,
      of: n,
    });
  }
  lines.sort((a, b) => b.times - a.times || b.qty - a.qty || a.productId.localeCompare(b.productId));
  return { lines, basedOn: n };
}

/** Upper median, rounded: [2, 3] → 3, [1, 2, 9] → 2. */
export function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)]);
}

const istWeekday = (d: Date) => new Date(d.getTime() + IST_MS).getUTCDay();
const istDayNumber = (d: Date) => Math.floor((d.getTime() + IST_MS) / DAY_MS);

export type Rhythm = {
  orders: number;
  usualGap: number | null;
  daysSince: number | null;
  dueIn: number | null;
  weekday: number | null;
};

/**
 * How often a shop orders: the average gap between its order days (at least
 * 3 days), days since the last one, days until the next is due (negative =
 * late), and its favourite IST weekday when at least 40% of orders (and 3)
 * fall on it.
 */
export function orderRhythm(dates: Date[], now: Date): Rhythm {
  const days = [...new Set(dates.filter((d) => d.getTime() <= now.getTime()).map(istDayNumber))].sort((a, b) => a - b);
  if (!days.length)
    return {
      orders: 0,
      usualGap: null,
      daysSince: null,
      dueIn: null,
      weekday: null,
    };
  const today = istDayNumber(now);
  const daysSince = today - days[days.length - 1];
  const usualGap = days.length > 1 ? Math.max(3, Math.round((days[days.length - 1] - days[0]) / (days.length - 1))) : null;
  const counts = new Map<number, number>();
  for (const d of dates) counts.set(istWeekday(d), (counts.get(istWeekday(d)) ?? 0) + 1);
  let weekday: number | null = null;
  for (const [w, c] of counts) if (c >= 3 && c / dates.length >= 0.4 && (weekday === null || c > counts.get(weekday)!)) weekday = w;
  return {
    orders: days.length,
    usualGap,
    daysSince,
    dueIn: usualGap === null ? null : usualGap - daysSince,
    weekday,
  };
}

// ---------- A5: route order ----------

export type Point = { lat: number; lng: number };

/** Metres from the depot through every point in order and back to the depot (straight lines). */
export function routeMetres(points: Point[], depot: Point | null): number {
  let total = 0;
  let prev: Point | null = depot;
  for (const p of points) {
    if (prev) total += metres(prev, p);
    prev = p;
  }
  if (depot && prev && points.length) total += metres(prev, depot);
  return Math.round(total);
}

export type SplitStop = {
  id: string;
  lat: number | null;
  lng: number | null;
  area: string;
};

/**
 * Split a day's drops into `k` trips of nearly equal size by sweeping round
 * the depot (or the drops' centre): drops are sorted by their angle and cut
 * into consecutive slices, so each trip covers one side of town. Drops with
 * no map pin join the trip that already has most drops of their area (else
 * the smallest). Route order inside each trip is left to `sequenceStops`.
 */
export function splitStops<T extends SplitStop>(stops: T[], depot: Point | null, k: number): T[][] {
  const n = Math.max(1, Math.min(k, stops.length || 1));
  const trips: T[][] = Array.from({ length: n }, () => []);
  const located = stops.filter((s): s is T & Point => s.lat !== null && s.lng !== null);
  const centre =
    depot ??
    (located.length
      ? {
          lat: avg(located.map((s) => s.lat)),
          lng: avg(located.map((s) => s.lng)),
        }
      : null);
  if (centre && located.length) {
    const angle = (s: Point) => Math.atan2(s.lat - centre.lat, (s.lng - centre.lng) * Math.cos((centre.lat * Math.PI) / 180));
    const sorted = [...located].sort((a, b) => angle(a) - angle(b) || a.id.localeCompare(b.id));
    // Start the sweep after the widest empty gap, so no trip straddles both sides of it.
    let cut = 0;
    let widest = -1;
    sorted.forEach((s, i) => {
      const next = sorted[(i + 1) % sorted.length];
      const gap = (angle(next) - angle(s) + 2 * Math.PI) % (2 * Math.PI) || (sorted.length === 1 ? 2 * Math.PI : 0);
      if (gap > widest) [widest, cut] = [gap, (i + 1) % sorted.length];
    });
    const ring = [...sorted.slice(cut), ...sorted.slice(0, cut)];
    ring.forEach((s, i) => trips[Math.floor((i * n) / ring.length)].push(s));
  }
  for (const s of stops) {
    if (s.lat !== null && s.lng !== null && centre) continue;
    let best = -1;
    let bestCount = 0;
    trips.forEach((tr, i) => {
      const c = tr.filter((x) => x.area === s.area).length;
      if (c > bestCount) [best, bestCount] = [i, c];
    });
    if (best < 0) best = trips.reduce((m, tr, i) => (tr.length < trips[m].length ? i : m), 0);
    trips[best].push(s);
  }
  return trips.filter((tr) => tr.length);
}

const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

// ---------- A7: who to visit ----------

export type VisitInput = {
  risk: ChurnRisk;
  dueIn: number | null; // from orderRhythm: ≤ 0 = an order is due
  overdue: number; // paise overdue
  overdueDays: number; // the oldest overdue bill, days past due
  schemeEndsIn: number | null; // days until a scheme the shop hasn't used ends
  visitedDaysAgo: number | null;
  orderedToday: boolean;
};

export const VISIT_REASON = {
  at_risk: "At risk of stopping",
  slipping: "Ordering less often",
  due: "Usual order due",
  overdue: "Money overdue",
  scheme: "Scheme ending soon",
  new: "New shop",
} as const;
export type VisitReason = keyof typeof VISIT_REASON;

/**
 * A priority score for visiting a shop, with the reasons behind it. 0 means
 * there is no reason to go (or it was just visited / ordered today).
 */
export function visitScore(v: VisitInput): {
  score: number;
  reasons: VisitReason[];
} {
  if (v.orderedToday) return { score: 0, reasons: [] };
  let score = 0;
  const reasons: VisitReason[] = [];
  if (v.risk === "high") {
    score += 40;
    reasons.push("at_risk");
  } else if (v.risk === "medium") {
    score += 25;
    reasons.push("slipping");
  } else if (v.risk === "new") {
    score += 5;
    reasons.push("new");
  }
  if (v.dueIn !== null && v.dueIn <= 0 && v.risk !== "high") {
    score += 20 + Math.min(10, -v.dueIn * 2);
    reasons.push("due");
  }
  if (v.overdue > 0) {
    score += 10 + Math.min(20, Math.floor(v.overdueDays / 3)) + Math.min(10, Math.floor(v.overdue / 500_000));
    reasons.push("overdue");
  }
  if (v.schemeEndsIn !== null && v.schemeEndsIn >= 0 && v.schemeEndsIn <= 7) {
    score += 10;
    reasons.push("scheme");
  }
  if (v.visitedDaysAgo !== null && v.visitedDaysAgo <= 2) score -= 30;
  return {
    score: Math.max(0, Math.min(100, score)),
    reasons: score > 0 ? reasons : [],
  };
}

// ---------- A12: credit risk and limits ----------

export type CreditInput = {
  limit: number; // current effective limit (paise); 0 = no credit
  creditDays: number;
  outstanding: number;
  overdue: number;
  maxOverdueDays: number;
  avgPayDays: number | null; // average days from bill to full payment, last 90 days
  bounces: number; // cheque bounces, last 90 days
  monthlySales: number; // average a month over the last 3 months (paise)
  risk: ChurnRisk;
};

export type CreditBand = "low" | "medium" | "high";
export const CREDIT_BAND_LABEL: Record<CreditBand, string> = {
  low: "Safe",
  medium: "Watch",
  high: "Risky",
};

/**
 * A 0–100 risk score (higher = riskier) from how late the shop pays, how
 * much is overdue, bounces and whether it is drifting away; the band; the
 * reasons in plain words; and a suggested limit when it differs enough from
 * today's: about one credit period of its sales, ×1.5 when safe, ×1 when
 * watched, ×0.5 when risky (rounded to ₹1,000, at least ₹1,000), 0 (cash
 * only) when a bill is over 60 days late.
 * Raises are suggested only for safe shops that pay on time.
 */
export function creditScore(c: CreditInput): {
  score: number;
  band: CreditBand;
  reasons: string[];
  suggestLimit: number | null;
} {
  const reasons: string[] = [];
  let score = 0;
  if (c.maxOverdueDays > 0) {
    score += Math.min(35, Math.ceil(c.maxOverdueDays / 2));
    reasons.push(`oldest overdue bill is ${c.maxOverdueDays} days late`);
  }
  if (c.overdue > 0 && c.outstanding > 0) {
    const share = c.overdue / c.outstanding;
    score += Math.round(share * 20);
    reasons.push(`${Math.round(share * 100)}% of what it owes is overdue`);
  }
  if (c.avgPayDays !== null && c.avgPayDays > c.creditDays) {
    score += Math.min(20, (c.avgPayDays - c.creditDays) * 2);
    reasons.push(`pays in ${c.avgPayDays} days on average (allowed ${c.creditDays})`);
  }
  if (c.bounces) {
    score += Math.min(20, c.bounces * 10);
    reasons.push(`${c.bounces} cheque bounce${c.bounces === 1 ? "" : "s"} in 90 days`);
  }
  if (c.limit > 0 && c.outstanding > c.limit) {
    score += 10;
    reasons.push("owes more than its limit");
  }
  if (c.risk === "high") {
    score += 10;
    reasons.push("has stopped ordering");
  } else if (c.risk === "medium") {
    score += 5;
    reasons.push("orders less often");
  }
  score = Math.min(100, score);
  const band: CreditBand = score >= 50 ? "high" : score >= 25 ? "medium" : "low";
  if (!reasons.length) reasons.push(c.avgPayDays !== null ? `pays on time (${c.avgPayDays} days on average)` : "nothing overdue");

  let target: number;
  if (c.maxOverdueDays > 60) target = 0;
  else {
    const period = c.monthlySales * (Math.max(1, c.creditDays) / 30);
    target = Math.max(100_000, roundTo(period * (band === "low" ? 1.5 : band === "medium" ? 1 : 0.5), 100_000));
  }
  const onTime = c.overdue === 0 && (c.avgPayDays === null || c.avgPayDays <= c.creditDays);
  let suggestLimit: number | null = null;
  const diff = target - c.limit;
  if (Math.abs(diff) >= 200_000 && Math.abs(diff) >= c.limit * 0.2) {
    if (diff < 0) suggestLimit = target;
    else if (band === "low" && onTime && c.monthlySales > 0 && c.limit > 0) suggestLimit = target;
  }
  return { score, band, reasons, suggestLimit };
}

const roundTo = (v: number, step: number) => Math.max(0, Math.round(v / step) * step);

// ---------- A9: checks that something may be wrong ----------

export type AnomalyKind = "cash_variance" | "far_from_shop" | "shop_closed" | "big_discount";
export const ANOMALY_LABEL: Record<AnomalyKind, string> = {
  cash_variance: "Cash short at hand-over",
  far_from_shop: "Delivered far from the shop",
  shop_closed: "Shop closed again and again",
  big_discount: "Unusual discount",
};

export const isFar = (at: Point | null, shop: Point | null, limitMetres: number) => (at && shop ? metres(at, shop) > limitMetres : false);

/** Percentage below the list price (0 when the price is at or above it). */
export const discountPct = (listPrice: number, charged: number) => (listPrice > 0 && charged < listPrice ? Math.round(((listPrice - charged) / listPrice) * 1000) / 10 : 0);
