/**
 * Phase 10 rules, stored in Tenant.settings.reports (Reports → Settings).
 * Client-safe.
 *
 * - The daily owner summary goes out at `summaryHour` IST (default 21:00) to
 *   every active admin: in the app, and on push / WhatsApp as set for the
 *   "Daily summary (owner)" message in Messages settings (WhatsApp needs the
 *   business's WhatsApp channel on).
 * - Route profitability takes off a delivery cost: `tripCost` per trip
 *   (spread over the trip's drops) plus `dropCost` per delivered drop. Both in
 *   paise; 0 = not counted.
 */
export type ReportSettings = {
  dailySummary: boolean;
  /** 0–23, IST. */
  summaryHour: number;
  tripCost: number;
  dropCost: number;
};

export const REPORT_DEFAULTS: ReportSettings = {
  dailySummary: true,
  summaryHour: 21,
  tripCost: 0,
  dropCost: 0,
};

export function reportSettings(settings: unknown): ReportSettings {
  const d = ((settings ?? {}) as { reports?: Partial<ReportSettings> }).reports ?? {};
  const m = { ...REPORT_DEFAULTS, ...d };
  return {
    dailySummary: m.dailySummary !== false,
    summaryHour: Number.isInteger(m.summaryHour) && m.summaryHour >= 0 && m.summaryHour <= 23 ? m.summaryHour : REPORT_DEFAULTS.summaryHour,
    tripCost: Number.isInteger(m.tripCost) && m.tripCost >= 0 ? m.tripCost : 0,
    dropCost: Number.isInteger(m.dropCost) && m.dropCost >= 0 ? m.dropCost : 0,
  };
}

const MAX_COST = 10_000_000; // ₹1,00,000 in paise

export function parseReportSettings(input: Record<string, unknown>): Partial<ReportSettings> | string {
  const out: Partial<ReportSettings> = {};
  if ("dailySummary" in input) out.dailySummary = input.dailySummary === true;
  if ("summaryHour" in input) {
    const h = input.summaryHour;
    if (typeof h !== "number" || !Number.isInteger(h) || h < 0 || h > 23) return "Pick the hour for the daily summary";
    out.summaryHour = h;
  }
  for (const k of ["tripCost", "dropCost"] as const) {
    if (!(k in input)) continue;
    const v = input[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_COST) return k === "tripCost" ? "Cost per trip must be 0 to ₹1,00,000" : "Cost per drop must be 0 to ₹1,00,000";
    out[k] = v;
  }
  return out;
}
