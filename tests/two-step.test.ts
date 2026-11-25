import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { prisma } from "@/lib/prisma";
import { tenantDb } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";
import { base32Decode, base32Encode, hashRecovery, matchTotp, newRecoveryCodes, newTotpSecret, otpauthUrl, spendRecoveryCode, stepAt, totpCode } from "@/lib/totp";
import { checkSecondFactor, mfaRequired, smsFallbackAllowed, tenantMfaStore } from "@/lib/mfa";
import { GoogleError, identityFromIdToken, readState } from "@/lib/google";

// RFC 6238 appendix B, SHA-1 key "12345678901234567890" (the 6-digit tail of each 8-digit value).
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("authenticator codes (TOTP)", () => {
  it("matches the RFC 6238 test values", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(RFC_SECRET, stepAt(59_000))).toBe("287082");
    expect(totpCode(RFC_SECRET, stepAt(1_111_111_109_000))).toBe("081804");
    expect(totpCode(RFC_SECRET, stepAt(1_234_567_890_000))).toBe("005924");
    expect(totpCode(RFC_SECRET, stepAt(2_000_000_000_000))).toBe("279037");
  });

  it("round-trips base32 and makes 160-bit secrets", () => {
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(base32Decode("gezd gnbv-gy3t qojq").toString()).toBe("1234567890");
  });

  it("accepts one step of clock drift, never a used or older step, never junk", () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), null, now)).toBe(step);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), null, now)).toBe(step - 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), null, now)).toBe(step + 1);
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), null, now)).toBeNull();
    // Already used this step (or a later one): refused.
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step), step, now)).toBeNull();
    expect(matchTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), step - 1, now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "12345", null, now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "abcdef", null, now)).toBeNull();
  });

  it("writes the otpauth link authenticator apps read", () => {
    const u = new URL(otpauthUrl(RFC_SECRET, "owner", "Sharma Distributors"));
    expect(u.protocol).toBe("otpauth:");
    expect(u.host).toBe("totp");
    expect(decodeURIComponent(u.pathname)).toBe("/Sharma Distributors:owner");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ secret: RFC_SECRET, issuer: "Sharma Distributors", digits: "6", period: "30" });
  });
});

describe("recovery codes", () => {
  it("are ten distinct easy-to-read codes, each usable once", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    const hashes = codes.map(hashRecovery);
    const left = spendRecoveryCode(hashes, codes[3].toUpperCase().replace("-", " "));
    expect(left).toHaveLength(9);
    expect(spendRecoveryCode(left!, codes[3])).toBeNull();
    expect(spendRecoveryCode(hashes, "zzzz-zzzz")).toBeNull();
  });
});

describe("who needs the second step", () => {
  it("is every staff role, and a shop only once it turned it on (when TWO_STEP_OFF=0)", () => {
    process.env.TWO_STEP_OFF = "0";
    for (const role of ["ADMIN", "SUPERVISOR", "SALES_AGENT", "DELIVERY_AGENT"] as const) expect(mfaRequired(role, null)).toBe(true);
    expect(mfaRequired("RETAILER", null)).toBe(false);
    expect(mfaRequired("RETAILER", new Date())).toBe(true);
    delete process.env.TWO_STEP_OFF;
  });

  it("never lets an SMS be both steps", () => {
    expect(smsFallbackAllowed("password")).toBe(true);
    expect(smsFallbackAllowed("google")).toBe(true);
    expect(smsFallbackAllowed("otp")).toBe(false);
    expect(smsFallbackAllowed("handoff")).toBe(false);
  });
});

describe("Google ID tokens", async () => {
  process.env.GOOGLE_CLIENT_ID = "client-123.apps.googleusercontent.com";
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
  const sign = (claims: Record<string, unknown>, aud = process.env.GOOGLE_CLIENT_ID!) =>
    new SignJWT({ email: "Owner@Gmail.com", email_verified: true, name: "Owner", nonce: "n1", ...claims })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer("https://accounts.google.com")
      .setAudience(aud)
      .setSubject("1098765")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

  it("gives the Google id and the address, lower-cased", async () => {
    await expect(identityFromIdToken(await sign({}), "n1", keys)).resolves.toEqual({ sub: "1098765", email: "owner@gmail.com", name: "Owner" });
  });

  it("refuses another nonce, another app, or an unverified address", async () => {
    await expect(identityFromIdToken(await sign({}), "other", keys)).rejects.toBeInstanceOf(GoogleError);
    await expect(identityFromIdToken(await sign({}, "someone-else"), "n1", keys)).rejects.toBeInstanceOf(GoogleError);
    await expect(identityFromIdToken(await sign({ email_verified: false }), "n1", keys)).rejects.toBeInstanceOf(GoogleError);
  });

  it("refuses a state it didn't sign", async () => {
    await expect(readState("not-a-token")).rejects.toBeInstanceOf(GoogleError);
  });
});

describe("checking a code against a saved login", () => {
  const made: string[] = [];
  afterAll(async () => {
    const t = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } });
    await tenantDb(t.id).user.deleteMany({ where: { id: { in: made } } });
  });

  it("uses each app code and each recovery code only once, and keeps secrets out of ordinary reads", async () => {
    const t = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } });
    const db = tenantDb(t.id);
    const tag = Date.now().toString(36);
    const u = await db.user.create({ data: { name: "2FA test", role: "SALES_AGENT", loginId: `mfa-${tag}` } });
    made.push(u.id);
    const store = tenantMfaStore(db, u.id);
    const secret = newTotpSecret();
    const codes = newRecoveryCodes();
    const now = Date.now();
    await store.enable(encryptSecret(secret), stepAt(now) - 5, codes.map(hashRecovery));

    expect(await checkSecondFactor(store, totpCode(secret, stepAt(now)), now)).toBe("app");
    expect(await checkSecondFactor(store, totpCode(secret, stepAt(now)), now)).toBeNull();
    expect(await checkSecondFactor(store, "000000", now)).toBeNull();
    expect(await checkSecondFactor(store, codes[0], now)).toBe("recovery");
    expect(await checkSecondFactor(store, codes[0], now)).toBeNull();
    expect((await store.load())?.recoveryCodes).toHaveLength(9);

    const plain = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    for (const k of ["totpSecret", "recoveryCodes", "googleSub", "passwordHash"]) expect(k in plain).toBe(false);
    expect(plain.totpEnabledAt).toBeInstanceOf(Date);
  });
});
