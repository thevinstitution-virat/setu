import { describe, expect, it } from "vitest";
import { forecastDemand, loadSuggestion, reorderNeed, zFor } from "@/lib/forecast-math";

const days = 56;
const weekdays = Array.from({ length: days }, (_, i) => i % 7);

describe("forecastDemand", () => {
  it("gives a flat series its own level with no spread", () => {
    const f = forecastDemand(Array(days).fill(4), weekdays, 3);
    expect(f).toMatchObject({ daily: 4, forDay: 4, weekdayFactor: 1, sigma: 0, activeDays: days, total: 4 * days });
  });

  it("learns a weekday pattern, pulled towards 1 and capped at 3", () => {
    const series = weekdays.map((wd) => (wd === 1 ? 7 : 0));
    const monday = forecastDemand(series, weekdays, 1);
    expect(monday.weekdayFactor).toBe(3);
    expect(monday.sigma).toBe(0);
    const tuesday = forecastDemand(series, weekdays, 2);
    expect(tuesday.weekdayFactor).toBeCloseTo(3 / 11, 2);
    expect(tuesday.forDay).toBeLessThan(monday.forDay);
  });

  it("weighs recent weeks most", () => {
    const rising = Array.from({ length: days }, (_, i) => (i < 28 ? 2 : 6));
    const f = forecastDemand(rising, weekdays, 0);
    expect(f.daily).toBeGreaterThan(4);
    expect(f.daily).toBeLessThan(6);
  });

  it("returns zeros with no demand", () => {
    expect(forecastDemand(Array(days).fill(0), weekdays, 0)).toMatchObject({ daily: 0, forDay: 0, sigma: 0, activeDays: 0 });
    expect(forecastDemand([], [], 0).daily).toBe(0);
  });
});

describe("zFor", () => {
  it("reads the table and interpolates", () => {
    expect(zFor(90)).toBeCloseTo(1.28);
    expect(zFor(95)).toBeCloseTo(1.64);
    expect(zFor(92.5)).toBeCloseTo(1.46);
    expect(zFor(40)).toBe(0);
    expect(zFor(100)).toBeCloseTo(2.33);
  });
});

describe("reorderNeed", () => {
  const base = { onOrder: 0, daily: 5, sigma: 0, leadDays: 3, coverDays: 7, serviceLevel: 90, caseSize: 12 };

  it("orders up to lead + cover in whole cases at or below the reorder point", () => {
    const r = reorderNeed({ ...base, available: 10 });
    expect(r).toEqual({ qty: 48, reorderPoint: 15, upTo: 50, daysLeft: 2, runsOutFirst: true });
  });

  it("does not order above the reorder point", () => {
    const r = reorderNeed({ ...base, available: 20 });
    expect(r.qty).toBe(0);
    expect(r.daysLeft).toBe(4);
    expect(r.runsOutFirst).toBe(false);
  });

  it("counts stock already on order", () => {
    expect(reorderNeed({ ...base, available: 10, onOrder: 10 }).qty).toBe(0);
  });

  it("adds safety stock for spread", () => {
    const r = reorderNeed({ ...base, available: 0, sigma: 2, caseSize: null });
    expect(r.reorderPoint).toBe(Math.ceil(15 + 1.28 * 2 * Math.sqrt(3)));
    expect(r.qty).toBe(r.upTo);
  });

  it("never orders for a product nobody buys", () => {
    expect(reorderNeed({ ...base, available: 0, daily: 0 })).toMatchObject({ qty: 0, daysLeft: null, runsOutFirst: false });
  });
});

describe("loadSuggestion", () => {
  it("tops up to the usual, in whole cases when the extra is big enough, never below booked", () => {
    expect(loadSuggestion({ booked: 10, forDay: 14.2, topUp: true, caseSize: 6 })).toEqual({ extra: 8, suggested: 18 });
    expect(loadSuggestion({ booked: 10, forDay: 14.2, topUp: false, caseSize: 6 })).toEqual({ extra: 0, suggested: 10 });
    expect(loadSuggestion({ booked: 20, forDay: 14.2, topUp: true })).toEqual({ extra: 0, suggested: 20 });
    // Less than half a case extra: loose units, not a full case.
    expect(loadSuggestion({ booked: 0, forDay: 4.1, topUp: true, caseSize: 24 })).toEqual({ extra: 5, suggested: 5 });
    expect(loadSuggestion({ booked: 0, forDay: 13, topUp: true, caseSize: 24 })).toEqual({ extra: 24, suggested: 24 });
  });
});
