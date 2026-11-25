import { afterEach, describe, expect, it } from "vitest";
import { mfaRequired, twoStepOff } from "@/lib/mfa";

describe("TWO_STEP_OFF (demo mode)", () => {
  afterEach(() => {
    delete process.env.TWO_STEP_OFF;
  });

  it("is off by default: the emailed code is the only step", () => {
    expect(twoStepOff()).toBe(true);
    expect(mfaRequired("ADMIN", null)).toBe(false);
    expect(mfaRequired("RETAILER", new Date())).toBe(false);
  });

  it("TWO_STEP_OFF=0 brings it back: staff need the second step, shops only if they opted in", () => {
    process.env.TWO_STEP_OFF = "0";
    expect(twoStepOff()).toBe(false);
    expect(mfaRequired("ADMIN", null)).toBe(true);
    expect(mfaRequired("RETAILER", null)).toBe(false);
    expect(mfaRequired("RETAILER", new Date())).toBe(true);
  });

  it("TWO_STEP_OFF=1 is still accepted", () => {
    process.env.TWO_STEP_OFF = "1";
    expect(twoStepOff()).toBe(true);
    expect(mfaRequired("ADMIN", new Date())).toBe(false);
    expect(mfaRequired("RETAILER", new Date())).toBe(false);
  });
});
