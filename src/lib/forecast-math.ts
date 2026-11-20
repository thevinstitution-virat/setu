/**
 * A6 demand forecast: pure maths, no database (client-safe).
 *
 * Demand = what shops ordered (not what was delivered), per product per IST
 * day over the last HISTORY_DAYS. The forecast for a day is the recent level
 * (an average that weighs the last two weeks most) times that weekday's usual
 * share; the spread of what actually happened around it gives the safety
 * stock. No AI: classic stock maths.
 */
import { roundUpToCase } from "@/lib/stock-math";

/** Days of order history the forecast reads. */
export const HISTORY_DAYS = 56;
/** A day's weight halves every this many days back. */
export const HALF_LIFE_DAYS = 14;

export type Forecast = {
  /** Expected units on an average day (the recent level). */
  daily: number;
  /** Expected units on the target weekday (level × weekday factor). */
  forDay: number;
  weekdayFactor: number;
  /** Spread (standard deviation) of a day's units around the forecast. */
  sigma: number;
  /** Days in the history with any demand. */
  activeDays: number;
  total: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Forecast from a daily series (oldest first, every day present, zeros
 * included) and the weekday (0 = Sunday) of each day.
 *
 * - level = exponentially weighted mean, half-life HALF_LIFE_DAYS;
 * - weekday factor = that weekday's mean ÷ the overall mean, pulled towards 1
 *   when there are few such days ((n × raw + 3) ÷ (n + 3)), at most 3;
 * - sigma = spread of each day around the overall mean × its weekday factor.
 */
export function forecastDemand(series: number[], weekdays: number[], targetWeekday: number): Forecast {
  const n = series.length;
  const total = series.reduce((a, q) => a + q, 0);
  const activeDays = series.filter((q) => q > 0).length;
  if (!n || total <= 0) return { daily: 0, forDay: 0, weekdayFactor: 1, sigma: 0, activeDays, total };

  let sw = 0;
  let swq = 0;
  series.forEach((q, i) => {
    const w = Math.pow(0.5, (n - 1 - i) / HALF_LIFE_DAYS);
    sw += w;
    swq += w * q;
  });
  const level = swq / sw;
  const mean = total / n;

  const byDay = new Map<number, number[]>();
  series.forEach((q, i) => byDay.set(weekdays[i], [...(byDay.get(weekdays[i]) ?? []), q]));
  const rawFactor = (wd: number) => {
    const qs = byDay.get(wd);
    if (!qs?.length) return 1;
    return qs.reduce((a, q) => a + q, 0) / qs.length / mean;
  };
  const shrunk = (wd: number) => {
    const k = byDay.get(wd)?.length ?? 0;
    return Math.min(3, (k * rawFactor(wd) + 3) / (k + 3));
  };

  let ss = 0;
  series.forEach((q, i) => {
    const r = q - mean * rawFactor(weekdays[i]);
    ss += r * r;
  });
  const sigma = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
  const factor = shrunk(targetWeekday);
  return { daily: round2(level), forDay: round2(level * factor), weekdayFactor: round2(factor), sigma: round2(sigma), activeDays, total };
}

/** One-sided normal z for a service level in % (how often stock should last): 90 → 1.28, 95 → 1.64. */
export function zFor(serviceLevel: number): number {
  const table: [number, number][] = [
    [50, 0],
    [75, 0.67],
    [80, 0.84],
    [85, 1.04],
    [90, 1.28],
    [95, 1.64],
    [97, 1.88],
    [98, 2.05],
    [99, 2.33],
  ];
  const s = Math.max(50, Math.min(99, serviceLevel));
  for (let i = 1; i < table.length; i++) {
    const [s1, z1] = table[i];
    const [s0, z0] = table[i - 1];
    if (s <= s1) return z0 + ((z1 - z0) * (s - s0)) / (s1 - s0);
  }
  return 2.33;
}

export type ReorderInput = {
  /** Sellable now, base units. */
  available: number;
  /** Ordered from the supplier and not yet received. */
  onOrder: number;
  daily: number;
  sigma: number;
  leadDays: number;
  coverDays: number;
  serviceLevel: number;
  caseSize?: number | null;
};

/**
 * Reorder point and order-up-to level ((s, S) policy):
 * - reorder point = daily × lead days + safety for the lead time;
 * - order up to   = daily × (lead + cover days) + safety for that span;
 * - safety = z(service level) × sigma × √days.
 * Suggest an order only when stock + on order is at or below the reorder
 * point: enough to reach the order-up-to level, in whole cases.
 */
export function reorderNeed(p: ReorderInput) {
  const z = zFor(p.serviceLevel);
  const lead = Math.max(0, p.leadDays);
  const span = lead + Math.max(1, p.coverDays);
  const safetyLead = z * p.sigma * Math.sqrt(Math.max(1, lead));
  const reorderPoint = Math.ceil(p.daily * lead + safetyLead);
  const upTo = Math.ceil(p.daily * span + z * p.sigma * Math.sqrt(span));
  const position = p.available + p.onOrder;
  const daysLeft = p.daily > 0 ? Math.floor(p.available / p.daily) : null;
  const qty = p.daily > 0 && position <= reorderPoint ? roundUpToCase(Math.max(0, upTo - position), p.caseSize) : 0;
  return {
    qty,
    reorderPoint,
    upTo,
    daysLeft,
    /** Runs out before a purchase order sent today would arrive. */
    runsOutFirst: daysLeft !== null && daysLeft < lead,
  };
}

/**
 * Next-day load for one product: what is booked for the day, and with topUp
 * the extra to reach the usual for that weekday (spot sales, late orders).
 * The total is rounded up to whole cases only when the extra is at least half
 * a case (no full case of 24 for a usual of 4). Never less than booked.
 */
export function loadSuggestion(p: { booked: number; forDay: number; topUp: boolean; caseSize?: number | null }) {
  const usual = Math.ceil(p.forDay);
  if (!p.topUp || usual <= p.booked) return { extra: 0, suggested: p.booked };
  const c = p.caseSize && p.caseSize > 1 ? p.caseSize : null;
  const suggested = Math.max(p.booked, c && usual - p.booked >= c / 2 ? roundUpToCase(usual, c) : usual);
  return { extra: suggested - p.booked, suggested };
}
