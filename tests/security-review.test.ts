/**
 * Security review (20 Nov 2026): the fixes that can be checked without a
 * browser. Pure rules first; then the OTP try limit under parallel guesses
 * and the downgrade rule, on the real database (a made-up phone and a
 * scratch business, removed at the end).
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb } from "@/lib/db";
import { clientIp } from "@/lib/audit";
import { privateIp } from "@/lib/webhooks";
import { pushEndpointAllowed } from "@/lib/security";
import { mayOpen } from "@/lib/storage";
import { toCsv } from "@/lib/field";
import { zipUnpackedSize } from "@/lib/importers";
import { fieldNeedsCheck } from "@/lib/money-api";
import { OtpError, verifyOtp } from "@/lib/otp";
import { RESERVED_SLUGS } from "@/lib/signup";
import { burnPasswordCheck } from "@/lib/password";
import { choosePlan, runBilling } from "@/lib/billing";
import { createTenantRecord } from "@/lib/signup";
import { purgeTenant } from "@/lib/tenant-data";

const run = Date.now().toString().slice(-6);
const cleanup: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  for (const f of cleanup.reverse()) await f().catch(() => null);
  await prisma.$disconnect();
});

describe("client address behind the proxy", () => {
  it("reads X-Forwarded-For from the right (what our proxy saw), not the left (what the client wrote)", () => {
    expect(clientIp("6.6.6.6, 203.0.113.9", null, 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9, 10.0.0.2", null, 2)).toBe("203.0.113.9");
    expect(clientIp("203.0.113.9", null, 1)).toBe("203.0.113.9");
    expect(clientIp(null, "198.51.100.4", 1)).toBe("198.51.100.4");
    expect(clientIp(null, null, 1)).toBeNull();
    // Fewer entries than hops (the CDN was skipped): the one entry is what our own proxy saw.
    expect(clientIp("6.6.6.6", "198.51.100.4", 2)).toBe("6.6.6.6");
  });
});

describe("private addresses for webhooks", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "198.18.0.1", "192.0.2.1",
    "::1", "::", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "junk",
  ])("refuses %s", (ip) => expect(privateIp(ip)).toBe(true));
  it.each(["8.8.8.8", "203.0.114.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("allows %s", (ip) => expect(privateIp(ip)).toBe(false));
});

describe("push endpoints", () => {
  it("only the browsers' push services, over https", () => {
    expect(pushEndpointAllowed("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(pushEndpointAllowed("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(pushEndpointAllowed("https://web.push.apple.com/Q")).toBe(true);
    expect(pushEndpointAllowed("http://fcm.googleapis.com/x")).toBe(false);
    expect(pushEndpointAllowed("https://fcm.googleapis.com.evil.in/x")).toBe(false);
    expect(pushEndpointAllowed("https://evilfcm.googleapis.com.in/x")).toBe(false);
    expect(pushEndpointAllowed("https://user:pw@fcm.googleapis.com/x")).toBe(false);
    expect(pushEndpointAllowed("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(pushEndpointAllowed("https://169.254.169.254/latest")).toBe(false);
    expect(pushEndpointAllowed("not a url")).toBe(false);
  });
});

describe("who may open which files", () => {
  it("never serves exports; selfies are staff only", () => {
    expect(mayOpen("t/abc/export/2026/11/x.gz", "ADMIN")).toBe(false);
    expect(mayOpen("t/abc/selfie/2026/11/x.jpg", "RETAILER")).toBe(false);
    expect(mayOpen("t/abc/selfie/2026/11/x.jpg", "SUPERVISOR")).toBe(true);
    expect(mayOpen("t/abc/product-image/2026/11/x.jpg", "RETAILER")).toBe(true);
  });
});

describe("CSV cells", () => {
  it("defuses formulas but leaves negative numbers alone", () => {
    const csv = toCsv([["=HYPERLINK(1)", "+1", "@x", "-5", "-2.50", "-x", "plain", 7]]);
    expect(csv).toContain(`'=HYPERLINK(1)`);
    expect(csv).toContain(`'+1`);
    expect(csv).toContain(`'@x`);
    expect(csv).toContain(`'-x`);
    expect(csv).toMatch(/(^|,)-5(,|$)/);
    expect(csv).toMatch(/(^|,)-2\.50(,|$)/);
  });
});

describe("spreadsheet size before unpacking", () => {
  it("reads the unpacked size from the zip directory, null for junk", () => {
    // A stored (uncompressed) zip with one 5-byte file, built by hand.
    const name = Buffer.from("a.txt");
    const data = Buffer.from("hello");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt32LE(5, 18);
    local.writeUInt32LE(5, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(5, 20);
    central.writeUInt32LE(5, 24);
    central.writeUInt16LE(name.length, 28);
    const cdOffset = local.length + name.length + data.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, data, central, name, end]);
    expect(zipUnpackedSize(zip)).toBe(5);
    expect(zipUnpackedSize(Buffer.from("not a zip"))).toBeNull();
  });
});

describe("money taken in the field", () => {
  it("UPI and bank from field staff wait for the office unless the business turns it off", () => {
    expect(fieldNeedsCheck("UPI", false, {})).toBe(true);
    expect(fieldNeedsCheck("BANK", false, {})).toBe(true);
    expect(fieldNeedsCheck("CASH", false, {})).toBe(false);
    expect(fieldNeedsCheck("UPI", true, {})).toBe(false);
    expect(fieldNeedsCheck("UPI", false, { money: { checkFieldDigital: false } })).toBe(false);
  });
});

describe("sign-up and sign-in", () => {
  it("keeps look-alike addresses for us", () => {
    for (const s of ["console", "auth", "secure", "webmail", "smtp", "ns1", "m"]) expect(RESERVED_SLUGS.has(s)).toBe(true);
  });
  it("an unknown login ID still costs a password check, and never passes", () => {
    const t = Date.now();
    expect(burnPasswordCheck("anything")).toBe(false);
    expect(burnPasswordCheck("anything")).toBe(false);
    expect(Date.now() - t).toBeGreaterThan(5);
  });
});

describe("OTP tries", () => {
  it("parallel wrong guesses can't get past five", async () => {
    const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true } });
    const db = tenantDb(demo.id);
    const phone = `70${run}99`;
    const c = await db.otpChallenge.create({ data: { phone, codeHash: "00".repeat(32), expiresAt: new Date(Date.now() + 5 * 60_000) } });
    cleanup.push(() => db.otpChallenge.deleteMany({ where: { phone } }));
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => verifyOtp(db, phone, String(100000 + i))));
    const answered = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    expect(answered).toHaveLength(5);
    expect(answered.every((r) => r.status === "fulfilled" && r.value === false)).toBe(true);
    expect(refused).toHaveLength(7);
    expect(refused.every((r) => r.status === "rejected" && r.reason instanceof OtpError)).toBe(true);
    expect((await db.otpChallenge.findUniqueOrThrow({ where: { id: c.id } })).attempts).toBe(5);
  });
});

describe("plan changes", () => {
  it("a cheaper plan waits for the next month, a dearer one starts now, hidden plans can't be picked", async () => {
    const { tenant } = await asPlatform((tx) =>
      createTenantRecord(tx, { slug: `sec${run}`, name: `Security test ${run}`, stateCode: "27", planCode: "growth", now: new Date() }, { name: "Owner", loginId: "owner", password: "Strong-pass-123" })
    );
    const id = tenant.id;
    cleanup.push(() => purgeTenant(id));
    await expect(choosePlan(id, "trial")).rejects.toThrow(/plans on offer/);
    // The trial ends: Growth starts.
    const trial = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    const start = new Date(trial.trialEndsAt!.getTime() + 60_000);
    await runBilling(start, [id]);
    const sub = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    expect(sub).toMatchObject({ status: "ACTIVE", planCode: "growth" });

    await choosePlan(id, "premium", start);
    expect(await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }))).toMatchObject({ planCode: "premium", nextPlanCode: null });

    // Down to Starter: this month stays on Premium.
    await choosePlan(id, "starter", start);
    const down = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    expect(down).toMatchObject({ planCode: "premium", nextPlanCode: "starter" });

    await runBilling(new Date(down.periodEnd.getTime() + 60_000), [id]);
    const after = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    expect(after).toMatchObject({ planCode: "starter", nextPlanCode: null });
    const inv = await asPlatform((tx) => tx.platformInvoice.findFirstOrThrow({ where: { tenantId: id } }));
    expect(inv.taxable).toBeGreaterThanOrEqual(6_99_900); // the month just ended was billed on Premium
    expect((await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id }, select: { plan: true } }))).plan).toBe("starter");
  });
});

describe("open items (second pass)", () => {
  it("webhook connections use only the addresses the check saw", async () => {
    const { pinnedLookup, PrivateAddressError } = await import("@/lib/webhooks");
    const ask = (host: string, all: boolean) =>
      new Promise<{ err: unknown; addr: unknown }>((resolve) => pinnedLookup(host, { all }, (err, addr) => resolve({ err, addr })));
    // A name that resolves to a private address is refused at connect time, whatever it said earlier.
    const r = await ask("localhost", false);
    expect(r.err).toBeInstanceOf(PrivateAddressError);
    expect((await ask("localhost", true)).err).toBeInstanceOf(PrivateAddressError);
    // Dev switch: allowed, and the socket gets the checked address.
    process.env.ALLOW_PRIVATE_WEBHOOKS = "1";
    try {
      const ok = await ask("localhost", true);
      expect(ok.err).toBeNull();
      expect(Array.isArray(ok.addr) && ok.addr.length > 0).toBe(true);
    } finally {
      delete process.env.ALLOW_PRIVATE_WEBHOOKS;
    }
  });

  it("the sign-in page shows only our own messages", async () => {
    const { noticeCode, noticeText } = await import("@/lib/login-notices");
    expect(noticeText("Call 99999 99999 to restore your account")).toBeNull();
    expect(noticeText(null)).toBeNull();
    const code = noticeCode("This link has expired. Switch again from the other business.", "switch");
    expect(code).toBe("switch-expired");
    expect(noticeText(code)).toMatch(/expired/);
    expect(noticeCode("anything else", "support")).toBe("link-failed");
    expect(noticeText("link-failed")).toMatch(/didn't work/);
  });
});
