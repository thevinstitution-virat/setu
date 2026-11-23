/**
 * Fixes from the security report of 23 Nov 2026: signing secrets fail closed,
 * stored secrets need a full GCM tag, GST rates parse fully, the e-invoice
 * sandbox stays out of production, and one UPI/bank reference pays once even
 * when two requests race.
 */
import "dotenv/config";
import { createCipheriv, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb } from "@/lib/db";
import { createTenantRecord } from "@/lib/signup";
import { purgeTenant } from "@/lib/tenant-data";
import { MoneyError, recordPayment, withMoney } from "@/lib/ledger";
import { appSecret, devOrTest } from "@/lib/app-secret";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { parseGstRate } from "@/lib/importers";
import { einvoiceSandboxAllowed } from "@/lib/einvoice";
import { REPORT_ONLY_CSP, SECURITY_HEADERS } from "@/lib/security";

const rand = () => Math.random().toString(36).slice(2, 8);
const LONG = "x".repeat(40);

describe("signing secrets", () => {
  it("lets only development and the tests use the public stand-in", () => {
    expect(devOrTest()).toBe(true); // vitest runs with NODE_ENV=test
    expect(appSecret("SESSION_SECRET", { NODE_ENV: "development" })).toBe("setu-dev-secret-change-me");
    expect(appSecret("PLATFORM_SESSION_SECRET", { NODE_ENV: "test", PLATFORM_SESSION_SECRET: LONG })).toBe(LONG);
  });

  it("refuses a missing, short or development secret anywhere else", () => {
    for (const NODE_ENV of ["production", undefined, "staging"]) {
      expect(() => appSecret("SESSION_SECRET", { NODE_ENV })).toThrow(/must be set/);
      expect(() => appSecret("SESSION_SECRET", { NODE_ENV, SESSION_SECRET: "short" })).toThrow(/at least 32/);
      expect(() => appSecret("PLATFORM_SESSION_SECRET", { NODE_ENV, PLATFORM_SESSION_SECRET: "" })).toThrow(/must be set/);
      expect(appSecret("SESSION_SECRET", { NODE_ENV, SESSION_SECRET: LONG })).toBe(LONG);
    }
    // Padded out to length, the public value is still refused.
    expect(() => appSecret("SESSION_SECRET", { NODE_ENV: "production", SESSION_SECRET: "setu-dev-secret-change-me" })).toThrow();
  });
});

describe("stored secrets", () => {
  it("round-trip, and refuse a shortened authentication tag", () => {
    const stored = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(stored)).toBe("JBSWY3DPEHPK3PXP");
    const [v, iv, tag, data] = stored.split(":");
    const short = Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url");
    expect(decryptSecret([v, iv, short, data].join(":"))).toBeNull();
    expect(decryptSecret([v, iv, "", data].join(":"))).toBeNull();
  });

  it("refuses a tag made with another key", () => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", randomBytes(32), iv);
    const data = Buffer.concat([c.update("x", "utf8"), c.final()]);
    expect(decryptSecret(["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(":"))).toBeNull();
  });
});

describe("GST rates in imports", () => {
  it("drops every % and space, not just the first", () => {
    expect(parseGstRate("18")).toBe(18);
    expect(parseGstRate("18%")).toBe(18);
    expect(parseGstRate(" 12 % ")).toBe(12);
    expect(parseGstRate("5%%")).toBe(5);
    expect(parseGstRate("0.25 %")).toBe(0.25);
    expect(parseGstRate("%")).toBeNaN();
    expect(parseGstRate("18%x")).toBeNaN();
  });
});

describe("e-invoice test mode", () => {
  it("is for development, the tests and flagged demo copies only", () => {
    expect(einvoiceSandboxAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(einvoiceSandboxAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(einvoiceSandboxAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(einvoiceSandboxAllowed({ NODE_ENV: "production", ALLOW_EINVOICE_SANDBOX: "1" })).toBe(true);
  });
});

describe("security headers", () => {
  it("adds CORP, COOP and a report-only full policy", () => {
    const h = Object.fromEntries(SECURITY_HEADERS.map((x) => [x.key, x.value]));
    expect(h["Cross-Origin-Resource-Policy"]).toBe("same-site");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(h["Content-Security-Policy-Report-Only"]).toBe(REPORT_ONLY_CSP);
    expect(REPORT_ONLY_CSP).toContain("default-src 'self'");
    expect(REPORT_ONLY_CSP).not.toMatch(/(^|[\s;])\*([\s;]|$)/);
  });
});

describe("one payment per UPI / bank reference", () => {
  let T = "";
  let shopId = "";

  beforeAll(async () => {
    const { tenant } = await asPlatform((tx) =>
      createTenantRecord(tx, { slug: `sec${rand()}`, name: `Security test ${rand()}`, stateCode: "27" }, { name: "Owner", loginId: "owner", password: "Strong-pass-123", phone: "9811100001" })
    );
    T = tenant.id;
    const db = tenantDb(T);
    const region = await db.region.create({ data: { name: "Pune", areas: { create: [{ name: "Kothrud" }] } }, include: { areas: true } });
    const u = await db.user.create({
      data: { name: "Shop", phone: "9000012345", role: "RETAILER", retailerProfile: { create: { outletName: "Shop", shopNumber: "1", complexName: "M", pinCode: "411038", areaId: region.areas[0].id, creditDays: 7 } } },
      include: { retailerProfile: true },
    });
    shopId = u.retailerProfile!.id;
  });

  afterAll(async () => {
    if (T) await purgeTenant(T).catch(() => null);
    await prisma.$disconnect();
  });

  const report = (reference: string, method: "UPI" | "BANK" | "CASH" = "UPI") =>
    withMoney(T, null, (ctx) =>
      recordPayment(ctx, { retailerId: shopId, amount: 50_000, method, purpose: "DUES", reference, needsVerification: true, collectorId: null })
    );

  it("lets only one of two requests at the same moment use a reference", async () => {
    const utr = `4321${Date.now()}`.slice(0, 12);
    const results = await Promise.allSettled([report(utr), report(utr), report(utr)]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(2);
    for (const r of refused) {
      expect(r.reason).toBeInstanceOf(MoneyError);
      expect((r.reason as MoneyError).status).toBe(409);
    }
    // Bank transfer with the same number: also the same money.
    await expect(report(utr, "BANK")).rejects.toMatchObject({ status: 409 });
  });

  it("frees the reference once the payment is rejected", async () => {
    const utr = `9876${Date.now()}`.slice(0, 12);
    const first = await report(utr);
    await tenantDb(T).payment.update({ where: { id: first.id }, data: { state: "REJECTED" } });
    await expect(report(utr)).resolves.toMatchObject({ reference: utr, state: "PENDING_VERIFICATION" });
  });
});
