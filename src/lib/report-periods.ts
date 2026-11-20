/**
 * Report periods (client-safe): IST days from..to, presets, the period just
 * before, and % change.
 */
import { addDay, daysInclusive, isDay, istDay, istDayRange } from "@/lib/field-math";
import { MoneyError } from "@/lib/money-error";

export type Period = { from: string; to: string; start: Date; end: Date; days: number };
export const MAX_DAYS = 366;

/** IST days from..to inclusive; start inclusive, end exclusive. */
export function makePeriod(from: string, to: string): Period {
  if (!isDay(from) || !isDay(to) || to < from) throw new MoneyError("Pick the dates");
  const days = daysInclusive(from, to);
  if (days > MAX_DAYS) throw new MoneyError("Reports cover at most a year");
  return { from, to, start: istDayRange(from).from, end: istDayRange(to).to, days };
}

/** The same number of days just before. */
export function previousPeriod(p: Period): Period {
  const to = addDay(p.from, -1);
  return makePeriod(addDay(to, -(p.days - 1)), to);
}

export const PRESETS = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  mtd: "This month",
  last_month: "Last month",
  "90d": "Last 90 days",
  fy: "This financial year",
} as const;
export type Preset = keyof typeof PRESETS;
export const isPreset = (v: unknown): v is Preset => typeof v === "string" && v in PRESETS;

export function presetPeriod(key: Preset, now = new Date()): Period {
  const today = istDay(now);
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (key) {
    case "today":
      return makePeriod(today, today);
    case "yesterday":
      return makePeriod(addDay(today, -1), addDay(today, -1));
    case "7d":
      return makePeriod(addDay(today, -6), today);
    case "90d":
      return makePeriod(addDay(today, -89), today);
    case "mtd":
      return makePeriod(monthStart, today);
    case "last_month": {
      const end = addDay(monthStart, -1);
      return makePeriod(`${end.slice(0, 7)}-01`, end);
    }
    case "fy": {
      const y = Number(today.slice(0, 4));
      const fy = Number(today.slice(5, 7)) >= 4 ? y : y - 1;
      return makePeriod(`${fy}-04-01`, today);
    }
    default:
      return makePeriod(addDay(today, -29), today);
  }
}

/** ?from=&to= (IST days) or ?preset= (default last 30 days). */
export function parsePeriod(sp: URLSearchParams, now = new Date()): { period: Period; preset: Preset | null } {
  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) return { period: makePeriod(from ?? "", to ?? ""), preset: null };
  const preset = isPreset(sp.get("preset")) ? (sp.get("preset") as Preset) : "30d";
  return { period: presetPeriod(preset, now), preset };
}

/** % change, one decimal; null when there is nothing to compare with. */
export function change(now: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((now - prev) * 1000) / Math.abs(prev)) / 10;
}

