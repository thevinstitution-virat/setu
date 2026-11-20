import { describe, expect, it } from "vitest";
import { classifyHost } from "@/lib/tenant";
import { formatINR, toPaise, gstOn } from "@/lib/money";
import { fyLabel, formatOrderNumber, priceBreakup } from "@/lib/orders";

describe("classifyHost", () => {
  const d = "sellerssetu.in";
  it("maps a subdomain to a tenant slug", () => {
    expect(classifyHost("agarwal.sellerssetu.in", d, null)).toEqual({ kind: "slug", slug: "agarwal" });
  });
  it("treats the bare domain and www as the platform site", () => {
    expect(classifyHost("sellerssetu.in", d, null)).toEqual({ kind: "platform" });
    expect(classifyHost("www.sellerssetu.in", d, null)).toEqual({ kind: "platform" });
  });
  it("uses DEFAULT_TENANT_SLUG on the bare domain when set", () => {
    expect(classifyHost("localhost", "localhost", "demo")).toEqual({ kind: "slug", slug: "demo" });
  });
  it("refuses reserved and nested subdomains", () => {
    expect(classifyHost("api.sellerssetu.in", d, null)).toEqual({ kind: "platform" });
    expect(classifyHost("a.b.sellerssetu.in", d, null)).toEqual({ kind: "platform" });
  });
  it("treats any other host as a custom domain", () => {
    expect(classifyHost("order.agarwal.in", d, null)).toEqual({ kind: "custom", host: "order.agarwal.in" });
  });
});

describe("money", () => {
  it("converts rupees to paise without float drift", () => {
    expect(toPaise("85")).toBe(8500);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise("1,234.565")).toBe(123457);
  });
  it("formats Indian grouping", () => {
    expect(formatINR(12345678)).toBe("₹1,23,456.78");
    expect(formatINR(12350, { whole: true })).toBe("₹124");
  });
  it("rounds GST per line to the paisa", () => {
    expect(gstOn(4000 * 3, 12)).toBe(1440);
    expect(priceBreakup([{ quantity: 3, price: 3333, gstRate: 18 }])).toEqual({
      subtotal: 9999,
      gstAmount: 1800,
      totalAmount: 11799,
    });
  });
});

describe("order numbers", () => {
  it("uses the Indian financial year", () => {
    expect(fyLabel(new Date("2026-11-19"))).toBe("2627");
    expect(fyLabel(new Date("2027-03-31"))).toBe("2627");
    expect(fyLabel(new Date("2027-04-01"))).toBe("2728");
    expect(formatOrderNumber("2627", 42)).toBe("SO-2627-000042");
  });
});
