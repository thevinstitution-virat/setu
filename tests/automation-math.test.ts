import { describe, expect, it } from "vitest";
import { creditScore, discountPct, isFar, median, orderRhythm, routeMetres, splitStops, usualOrder, visitScore } from "@/lib/automation-math";

const NOW = new Date("2026-11-19T06:30:00Z"); // 12:00 IST, a Thursday
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("usual order", () => {
  it("takes products in at least half of the last orders, at their median quantity", () => {
    const orders = [
      { at: daysAgo(2), lines: [{ productId: "a", qty: 5 }, { productId: "b", qty: 2 }] },
      { at: daysAgo(9), lines: [{ productId: "a", qty: 4 }, { productId: "c", qty: 1 }] },
      { at: daysAgo(16), lines: [{ productId: "a", qty: 6 }, { productId: "b", qty: 3 }] },
      { at: daysAgo(23), lines: [{ productId: "a", qty: 5 }, { productId: "a", qty: 1 }] },
    ];
    const u = usualOrder(orders, NOW);
    expect(u.basedOn).toBe(4);
    expect(u.lines).toEqual([
      { productId: "a", qty: 6, times: 4, of: 4 }, // 5, 4, 6, 6 → upper median 6
      { productId: "b", qty: 3, times: 2, of: 4 },
    ]);
  });

  it("needs two orders and ignores old ones", () => {
    expect(usualOrder([{ at: daysAgo(1), lines: [{ productId: "a", qty: 1 }] }], NOW).lines).toEqual([]);
    expect(usualOrder([{ at: daysAgo(130), lines: [{ productId: "a", qty: 1 }] }, { at: daysAgo(140), lines: [{ productId: "a", qty: 1 }] }], NOW).basedOn).toBe(0);
  });

  it("uses the upper median", () => {
    expect(median([2, 3])).toBe(3);
    expect(median([1, 2, 9])).toBe(2);
  });
});

describe("rhythm", () => {
  it("finds the usual gap, when the next order is due and the favourite weekday", () => {
    const r = orderRhythm([daysAgo(28), daysAgo(21), daysAgo(14), daysAgo(7)], NOW);
    expect(r).toEqual({ orders: 4, usualGap: 7, daysSince: 7, dueIn: 0, weekday: 4 });
  });

  it("counts one order per IST day and floors the gap at 3", () => {
    const r = orderRhythm([daysAgo(2), daysAgo(1), new Date(daysAgo(1).getTime() + 60_000)], NOW);
    expect(r.orders).toBe(2);
    expect(r.usualGap).toBe(3);
    expect(orderRhythm([], NOW).usualGap).toBeNull();
  });
});

describe("splitting a day into trips", () => {
  const depot = { lat: 26.85, lng: 80.95 };
  // Three drops north of the depot, three south, one with no pin in the north area.
  const north = [0, 1, 2].map((i) => ({ id: `n${i}`, lat: 26.9 + i * 0.002, lng: 80.94 + i * 0.01, area: "North" }));
  const south = [0, 1, 2].map((i) => ({ id: `s${i}`, lat: 26.8 - i * 0.002, lng: 80.94 + i * 0.01, area: "South" }));
  const loose = { id: "x", lat: null, lng: null, area: "North" };

  it("keeps each side of town on one trip, and puts unpinned drops with their area", () => {
    const trips = splitStops([...south, loose, ...north], depot, 2).map((t) => t.map((s) => s.id).sort());
    expect(trips).toHaveLength(2);
    expect(trips).toContainEqual(["n0", "n1", "n2", "x"]);
    expect(trips).toContainEqual(["s0", "s1", "s2"]);
  });

  it("never makes more trips than drops, and copes with no pins at all", () => {
    expect(splitStops(north.slice(0, 1), depot, 3)).toHaveLength(1);
    expect(splitStops([loose, { ...loose, id: "y" }], null, 2).flat()).toHaveLength(2);
  });

  it("measures a round trip", () => {
    expect(routeMetres([], depot)).toBe(0);
    expect(routeMetres([north[0]], depot)).toBeGreaterThan(11_000);
  });
});

describe("visit score", () => {
  const base = { risk: "low" as const, dueIn: 3, overdue: 0, overdueDays: 0, schemeEndsIn: null, visitedDaysAgo: null, orderedToday: false };

  it("gives no reason for a steady shop", () => {
    expect(visitScore(base)).toEqual({ score: 0, reasons: [] });
  });

  it("adds up the reasons", () => {
    const v = visitScore({ ...base, risk: "medium", overdue: 1_000_000, overdueDays: 12, schemeEndsIn: 3 });
    expect(v.reasons).toEqual(["slipping", "overdue", "scheme"]);
    expect(v.score).toBe(25 + (10 + 4 + 2) + 10);
  });

  it("skips shops that ordered today and lowers just-visited ones", () => {
    expect(visitScore({ ...base, risk: "high", orderedToday: true }).score).toBe(0);
    expect(visitScore({ ...base, risk: "high", visitedDaysAgo: 1 }).score).toBe(10);
  });

  it("marks a due order", () => {
    expect(visitScore({ ...base, dueIn: -2 })).toEqual({ score: 24, reasons: ["due"] });
  });
});

describe("credit score", () => {
  const steady = { limit: 2_000_000, creditDays: 15, outstanding: 800_000, overdue: 0, maxOverdueDays: 0, avgPayDays: 10, bounces: 0, monthlySales: 4_000_000, risk: "low" as const };

  it("suggests a raise only for a safe shop that pays on time", () => {
    const s = creditScore(steady);
    expect(s.band).toBe("low");
    expect(s.score).toBe(0);
    expect(s.suggestLimit).toBe(3_000_000); // ₹40,000 × 15/30 × 1.5
    expect(creditScore({ ...steady, avgPayDays: 20 }).suggestLimit).toBeNull();
  });

  it("cuts the limit of a late payer", () => {
    const s = creditScore({ ...steady, overdue: 600_000, maxOverdueDays: 40, avgPayDays: 35, bounces: 1, risk: "medium" });
    expect(s.band).toBe("high");
    expect(s.reasons).toContain("1 cheque bounce in 90 days");
    expect(s.suggestLimit).toBe(1_000_000); // × 0.5
  });

  it("moves a shop over 60 days late to cash only", () => {
    expect(creditScore({ ...steady, overdue: 800_000, maxOverdueDays: 70 }).suggestLimit).toBe(0);
  });

  it("leaves small differences alone", () => {
    expect(creditScore({ ...steady, limit: 2_900_000 }).suggestLimit).toBeNull();
  });
});

describe("checks", () => {
  it("measures distance and discount", () => {
    expect(isFar({ lat: 26.85, lng: 80.95 }, { lat: 26.851, lng: 80.95 }, 300)).toBe(false);
    expect(isFar({ lat: 26.85, lng: 80.95 }, { lat: 26.86, lng: 80.95 }, 300)).toBe(true);
    expect(isFar(null, { lat: 1, lng: 1 }, 300)).toBe(false);
    expect(discountPct(10_000, 8_000)).toBe(20);
    expect(discountPct(10_000, 12_000)).toBe(0);
  });
});
