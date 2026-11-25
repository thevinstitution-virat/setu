import { describe, expect, it } from "vitest";
import { formatINR } from "@/lib/money";

describe("formatINR compact", () => {
  it("keeps the normal format unchanged", () => {
    expect(formatINR(18400000)).toBe("₹1,84,000.00");
    expect(formatINR(18400000, { whole: true })).toBe("₹1,84,000");
  });
  it("uses Indian units", () => {
    expect(formatINR(48200000, { compact: true })).toBe("₹4.82L");
    expect(formatINR(1200000000, { compact: true })).toBe("₹1.2Cr");
    expect(formatINR(1240000, { compact: true })).toBe("₹12.4k");
    expect(formatINR(250000, { compact: true })).toBe("₹2,500");
    expect(formatINR(-48200000, { compact: true })).toBe("-₹4.82L");
    expect(formatINR(48200000, { compact: true, symbol: false })).toBe("4.82L");
  });
});
