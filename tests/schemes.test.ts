/** Phase 2 pure rules: scheme engine, cart settings, delivery days, Hindi search. */
import { describe, expect, it } from "vitest";
import { applySchemes, describeScheme, parseSchemeParams, splitProportional, type EngineLine, type EngineScheme } from "@/lib/schemes";
import { CART_DEFAULTS, deliveryChargeFor, deliveryDays, parseCartSettings, type CartSettings } from "@/lib/cart-settings";
import { marginPct, targets, visibleTo } from "@/lib/pricing";
import { devanagariToLatin, matches, searchText } from "@/lib/translit";

const line = (productId: string, quantity: number, price: number, o: Partial<EngineLine> = {}): EngineLine => ({
  productId,
  quantity,
  price,
  categoryPath: ["cat-food", "cat-root"],
  brandId: "brand-a",
  ...o,
});
let sid = 0;
const scheme = (o: Partial<EngineScheme> & Pick<EngineScheme, "type" | "params">): EngineScheme => ({
  id: `s${++sid}`,
  name: `Scheme ${sid}`,
  productIds: [],
  brandIds: [],
  categoryIds: [],
  stackable: true,
  priority: 100,
  budgetLeft: null,
  usesLeft: null,
  ...o,
});
const none = () => null;

describe("scheme params", () => {
  it("validates each type", () => {
    expect(parseSchemeParams("BUY_X_GET_Y", { buyQty: 10, getQty: 1 })).toEqual({ buyQty: 10, getQty: 1, freeProductId: null, maxSets: null });
    expect(parseSchemeParams("BUY_X_GET_Y", { buyQty: 0, getQty: 1 })).toMatch(/Buy quantity/);
    expect(parseSchemeParams("PERCENT", { percent: 120 })).toMatch(/Percent/);
    expect(parseSchemeParams("FLAT", { amount: 5000, perUnit: true })).toMatchObject({ amount: 5000, perUnit: true });
    expect(parseSchemeParams("SLAB", { basis: "qty", slabs: [{ min: 10, percent: 2, amount: 5 }] })).toMatch(/either/);
    const slab = parseSchemeParams("SLAB", { basis: "qty", slabs: [{ min: 50, percent: 5 }, { min: 10, percent: 2 }] });
    expect(slab).toMatchObject({ slabs: [{ min: 10 }, { min: 50 }] });
  });

  it("describes schemes in plain words", () => {
    expect(describeScheme("BUY_X_GET_Y", { buyQty: 10, getQty: 1 })).toBe("Buy 10 get 1 free");
    expect(describeScheme("PERCENT", { percent: 5, cap: 20000 })).toBe("5% off (up to ₹200)");
    expect(describeScheme("FLAT", { amount: 500, perUnit: true })).toBe("₹5 off per unit");
  });
});

describe("splitProportional", () => {
  it("splits exactly and never over a line", () => {
    const out = splitProportional(100, [333, 333, 334]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
    expect(splitProportional(50, [10, 20])).toEqual([10, 20]);
    expect(splitProportional(0, [10])).toEqual([0]);
  });
});

describe("applySchemes", () => {
  it("buy X get Y of the same product, per line, with max sets", () => {
    const r = applySchemes([line("p1", 25, 1000), line("p2", 9, 500)], [scheme({ type: "BUY_X_GET_Y", params: { buyQty: 10, getQty: 1, maxSets: null } })], none);
    expect(r.free).toEqual([{ productId: "p1", quantity: 2, schemeId: expect.any(String), unitPrice: 1000 }]);
    expect(r.applied[0]).toMatchObject({ value: 2000, freeQty: 2, discount: 0 });
    const capped = applySchemes([line("p1", 25, 1000)], [scheme({ type: "BUY_X_GET_Y", params: { buyQty: 10, getQty: 1, maxSets: 1 } })], none);
    expect(capped.free[0].quantity).toBe(1);
  });

  it("cross-SKU free goods pooled over the scope", () => {
    const s = scheme({ type: "BUY_X_GET_Y", params: { buyQty: 12, getQty: 1, freeProductId: "gift" }, brandIds: ["brand-a"] });
    const r = applySchemes([line("p1", 6, 1000), line("p2", 6, 800), line("p3", 50, 100, { brandId: "brand-b" })], [s], (id) => (id === "gift" ? 300 : null));
    expect(r.free).toEqual([{ productId: "gift", quantity: 1, schemeId: s.id, unitPrice: 300 }]);
    // Free product not available to this retailer → skipped.
    expect(applySchemes([line("p1", 12, 1000)], [s], none).applied).toEqual([]);
  });

  it("percent with cap and minimum, split by line value", () => {
    const s = scheme({ type: "PERCENT", params: { percent: 10, cap: 1500, minValue: 10000 } });
    const r = applySchemes([line("p1", 10, 1000), line("p2", 10, 500)], [s], none);
    expect(r.discounts).toEqual([1000, 500]);
    expect(applySchemes([line("p1", 5, 1000)], [s], none).applied).toEqual([]);
  });

  it("slab picks the highest slab reached", () => {
    const s = scheme({ type: "SLAB", params: { basis: "qty", slabs: [{ min: 10, percent: 2 }, { min: 50, percent: 5 }] } });
    expect(applySchemes([line("p1", 60, 1000)], [s], none).discounts).toEqual([3000]);
    expect(applySchemes([line("p1", 20, 1000)], [s], none).discounts).toEqual([400]);
    expect(applySchemes([line("p1", 9, 1000)], [s], none).applied).toEqual([]);
    const flat = scheme({ type: "SLAB", params: { basis: "value", slabs: [{ min: 50000, amount: 2500 }] } });
    expect(applySchemes([line("p1", 50, 1000)], [flat], none).discounts).toEqual([2500]);
  });

  it("flat per unit never takes a line below zero", () => {
    const s = scheme({ type: "FLAT", params: { amount: 800, perUnit: true } });
    expect(applySchemes([line("p1", 3, 500)], [s], none).discounts).toEqual([1500]);
  });

  it("scope by category includes sub-categories", () => {
    const s = scheme({ type: "PERCENT", params: { percent: 10 }, categoryIds: ["cat-root"] });
    const r = applySchemes([line("p1", 1, 1000), line("p2", 1, 1000, { categoryPath: ["other"] })], [s], none);
    expect(r.discounts).toEqual([100, 0]);
  });

  it("stacking: later percent works on what is left; non-stackable locks lines", () => {
    const a = scheme({ type: "PERCENT", params: { percent: 10 }, priority: 1 });
    const b = scheme({ type: "PERCENT", params: { percent: 10 }, priority: 2 });
    expect(applySchemes([line("p1", 10, 1000)], [b, a], none).discounts).toEqual([1900]);
    const excl = scheme({ type: "FLAT", params: { amount: 500 }, priority: 1, stackable: false, productIds: ["p1"] });
    const r = applySchemes([line("p1", 10, 1000), line("p2", 10, 1000)], [excl, b], none);
    expect(r.discounts).toEqual([500, 1000]);
    expect(r.lineSchemes).toEqual([[excl.id], [b.id]]);
    // A non-stackable scheme skips lines already touched.
    const late = scheme({ type: "FLAT", params: { amount: 300 }, priority: 5, stackable: false });
    expect(applySchemes([line("p1", 10, 1000)], [a, late], none).applied.map((x) => x.schemeId)).toEqual([a.id]);
  });

  it("budget caps discount and free sets; uses left", () => {
    const s = scheme({ type: "PERCENT", params: { percent: 50 }, budgetLeft: 700 });
    const r = applySchemes([line("p1", 10, 1000)], [s], none);
    expect(r.discounts).toEqual([700]);
    expect(r.applied[0].capped).toBe(true);
    const g = scheme({ type: "BUY_X_GET_Y", params: { buyQty: 1, getQty: 1 }, budgetLeft: 2500 });
    expect(applySchemes([line("p1", 5, 1000)], [g], none).free[0].quantity).toBe(2);
    expect(applySchemes([line("p1", 5, 1000)], [{ ...g, budgetLeft: 0 }], none).applied).toEqual([]);
    expect(applySchemes([line("p1", 5, 1000)], [{ ...g, budgetLeft: null, usesLeft: 0 }], none).applied).toEqual([]);
  });
});

describe("cart settings", () => {
  const s = (o: Partial<CartSettings>) => ({ ...CART_DEFAULTS, ...o });
  it("validates", () => {
    expect(parseCartSettings({ cutoffTime: "25:00" })).toMatch(/HH:MM/);
    expect(parseCartSettings({ closedWeekdays: [0, 1, 2, 3, 4, 5, 6] })).toMatch(/open day/);
    expect(parseCartSettings({ minOrderValue: 50000, closedWeekdays: [0, 0] })).toEqual({ minOrderValue: 50000, closedWeekdays: [0] });
  });
  it("delivery charge with free-above", () => {
    expect(deliveryChargeFor(s({ deliveryCharge: 5000, freeDeliveryAbove: 100000 }), 99999)).toBe(5000);
    expect(deliveryChargeFor(s({ deliveryCharge: 5000, freeDeliveryAbove: 100000 }), 100000)).toBe(0);
    expect(deliveryChargeFor(s({}), 10)).toBe(0);
  });
  it("delivery days: lead, IST cut-off, closed days, holidays, choice", () => {
    // Thu 19 Nov 2026, 10:00 IST = 04:30 UTC.
    const morning = new Date("2026-11-19T04:30:00Z");
    const evening = new Date("2026-11-19T13:30:00Z"); // 19:00 IST
    expect(deliveryDays(s({}), morning)).toEqual(["2026-11-20"]);
    expect(deliveryDays(s({ cutoffTime: "17:00" }), evening)).toEqual(["2026-11-21"]);
    expect(deliveryDays(s({ cutoffTime: "17:00", closedWeekdays: [6, 0] }), evening)).toEqual(["2026-11-23"]);
    expect(deliveryDays(s({ holidays: ["2026-11-20"] }), morning)).toEqual(["2026-11-21"]);
    expect(deliveryDays(s({ allowDateChoice: true, maxDaysAhead: 3, closedWeekdays: [0] }), morning)).toEqual(["2026-11-20", "2026-11-21", "2026-11-23"]);
    // 23:00 UTC on the 19th is already the 20th in IST.
    expect(deliveryDays(s({ leadDays: 0 }), new Date("2026-11-19T20:00:00Z"))).toEqual(["2026-11-20"]);
  });
});

describe("visibility, targeting, margin", () => {
  const r = { id: "r1", areaId: "a1", priceListId: null, groupIds: ["g1"] };
  it("empty = everyone; else area or group (or retailer)", () => {
    expect(visibleTo({ visibleAreaIds: [], visibleGroupIds: [] }, r)).toBe(true);
    expect(visibleTo({ visibleAreaIds: ["a2"], visibleGroupIds: [] }, r)).toBe(false);
    expect(visibleTo({ visibleAreaIds: ["a2"], visibleGroupIds: ["g1"] }, r)).toBe(true);
    expect(targets({ areaIds: [], groupIds: [], retailerIds: ["r2"] }, r)).toBe(false);
    expect(targets({ areaIds: [], groupIds: [], retailerIds: ["r1"] }, r)).toBe(true);
  });
  it("margin on MRP after GST", () => {
    // Rate ₹80 + 5% GST = ₹84 landed, MRP ₹100 → 16%.
    expect(marginPct(8000, 5, 10000)).toBe(16);
    expect(marginPct(8000, 5, 0)).toBeNull();
  });
});

describe("Hindi / English search", () => {
  it("transliterates Devanagari", () => {
    expect(devanagariToLatin("चाय")).toBe("chaay");
    expect(devanagariToLatin("बिस्कुट")).toBe("biskut");
  });
  it("matches across scripts and spellings", () => {
    const tea = searchText(["Masala Chai 250g", "मसाला चाय", null, "TEA-250"]);
    expect(matches(tea, "chai")).toBe(true);
    expect(matches(tea, "masaala")).toBe(true);
    expect(matches(tea, "चाय")).toBe(true);
    expect(matches(tea, "coffee")).toBe(false);
    const biscuit = searchText(["बिस्कुट"]);
    expect(matches(biscuit, "biskut")).toBe(true);
    expect(matches(biscuit, "biscuit")).toBe(true);
    expect(matches(searchText(["Atta 5kg"]), "आटा")).toBe(true);
  });
});
