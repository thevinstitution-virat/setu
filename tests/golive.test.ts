/**
 * Phase 15 go-live hardening: the cross-site write guard, the session secret
 * rule, the password sign-in limits (on the real database, with a made-up
 * scope that is deleted at the end), and the readiness checks.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { crossSiteRefused, secretProblem, SECURITY_HEADERS } from "@/lib/security";
import { LOGIN_WINDOW_MS, MAX_PER_IP, MAX_PER_LOGIN, lockedMessage, loginLocked, purgeLoginAttempts, recordLogin } from "@/lib/login-limit";
import { dbChecks, envChecks, goLiveReport } from "@/lib/golive";

const SCOPE = `test-${Math.random().toString(36).slice(2, 10)}`;
const IP = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

afterAll(async () => {
  await prisma.authAttempt.deleteMany({ where: { OR: [{ scope: SCOPE }, { scope: `${SCOPE}-b` }] } });
  await prisma.$disconnect();
});

describe("cross-site writes", () => {
  const req = (over: Partial<Parameters<typeof crossSiteRefused>[0]>) => crossSiteRefused({ method: "POST", path: "/api/orders", origin: "https://demo.setu.in", host: "demo.setu.in", ...over });

  it("lets same-site writes and requests without an Origin through", () => {
    expect(req({})).toBe(false);
    expect(req({ origin: null })).toBe(false);
    expect(req({ origin: "http://demo.localhost:3101", host: "demo.localhost:3101" })).toBe(false);
  });

  it("refuses writes from another site, a null origin and junk", () => {
    expect(req({ origin: "https://evil.example" })).toBe(true);
    expect(req({ origin: "https://other.setu.in" })).toBe(true);
    expect(req({ origin: "null" })).toBe(true);
    expect(req({ origin: "not a url" })).toBe(true);
  });

  it("leaves reads, pages and webhooks alone", () => {
    expect(req({ method: "GET", origin: "https://evil.example" })).toBe(false);
    expect(req({ path: "/login", origin: "https://evil.example" })).toBe(false);
    expect(req({ path: "/api/webhooks/razorpay/abc", origin: "https://evil.example" })).toBe(false);
    expect(req({ path: "/api/platform/webhooks/razorpay", origin: "https://evil.example" })).toBe(false);
    expect(req({ path: "/api/v1/orders", origin: "https://evil.example" })).toBe(false);
    for (const m of ["PUT", "PATCH", "DELETE"]) expect(req({ method: m, origin: "https://evil.example" })).toBe(true);
  });

  it("sends the security headers", () => {
    const h = Object.fromEntries(SECURITY_HEADERS.map((x) => [x.key, x.value]));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Permissions-Policy"]).toContain("camera=(self)");
  });
});

describe("session secret", () => {
  it("must be set, not the dev default, and 32+ characters", () => {
    expect(secretProblem(undefined)).toMatch(/not set/);
    expect(secretProblem("setu-dev-secret-change-me")).toMatch(/default/i);
    expect(secretProblem("short")).toMatch(/32/);
    expect(secretProblem("x".repeat(32))).toBeNull();
  });
});

describe("password sign-in limits", () => {
  const t0 = new Date();
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);

  it(`locks a login after ${MAX_PER_LOGIN} wrong passwords and lifts it as they age`, async () => {
    for (let i = 0; i < MAX_PER_LOGIN - 1; i++) await recordLogin(SCOPE, "Ravi", IP, false, at(i));
    expect(await loginLocked(SCOPE, "ravi", IP, at(4))).toBe(0);
    await recordLogin(SCOPE, " RAVI ", IP, false, at(4)); // same login, any case
    const wait = await loginLocked(SCOPE, "ravi", IP, at(5));
    expect(wait).toBe(10); // the first try (minute 0) leaves the window at minute 15
    expect(lockedMessage(wait)).toBe("Too many wrong tries. Try again in 10 minutes.");
    expect(lockedMessage(1)).toBe("Too many wrong tries. Try again in 1 minute.");
    expect(await loginLocked(SCOPE, "ravi", IP, new Date(at(0).getTime() + LOGIN_WINDOW_MS + 1000))).toBe(0);
    // Another business's login with the same id is not locked.
    expect(await loginLocked(`${SCOPE}-b`, "ravi", null, at(5))).toBe(0);
  });

  it("a right password clears that login's wrong tries", async () => {
    await recordLogin(SCOPE, "ravi", IP, true, at(6));
    expect(await loginLocked(SCOPE, "ravi", IP, at(6))).toBe(0);
    expect(await prisma.authAttempt.count({ where: { scope: SCOPE, key: "ravi", ok: false } })).toBe(0);
  });

  it(`locks an address after ${MAX_PER_IP} wrong passwords across logins`, async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250) + 1}`;
    await prisma.authAttempt.createMany({ data: Array.from({ length: MAX_PER_IP }, (_, i) => ({ scope: `${SCOPE}-b`, key: `user${i}`, ip, ok: false, createdAt: at(i / 10) })) });
    expect(await loginLocked(SCOPE, "someone-new", ip, at(4))).toBeGreaterThan(0);
    expect(await loginLocked(SCOPE, "someone-new", null, at(4))).toBe(0);
  });

  it("the daily clean-up removes tries older than a day", async () => {
    await recordLogin(SCOPE, "old", IP, false, new Date(t0.getTime() - 2 * 86_400_000));
    expect(await purgeLoginAttempts(t0)).toBeGreaterThanOrEqual(1);
    expect(await prisma.authAttempt.count({ where: { scope: SCOPE, key: "old" } })).toBe(0);
  });
});

describe("go-live readiness", () => {
  const good = {
    SESSION_SECRET: "s".repeat(40),
    SECRETS_KEY: "k".repeat(40),
    PLATFORM_DOMAIN: "setu.in",
    SMS_PROVIDER: "",
    STORAGE_DRIVER: "s3",
    S3_BUCKET: "b",
    S3_ACCESS_KEY_ID: "a",
    S3_SECRET_ACCESS_KEY: "s",
    APP_ENV: "prod",
    TELEGRAM_BOT_TOKEN: "t",
    TELEGRAM_CHAT_ID: "1",
  };
  const status = (env: Record<string, string | undefined>) => Object.fromEntries(envChecks(env).map((c) => [c.id, c.status]));

  it("passes a well set server except the missing SMS provider", () => {
    const s = status(good);
    expect(Object.entries(s).filter(([, v]) => v === "fail").map(([k]) => k)).toEqual(["sms"]);
    expect(s.session_secret).toBe("ok");
    expect(s.storage).toBe("ok");
  });

  it("fails the unsafe switches", () => {
    const s = status({ ...good, OTP_DEV_MODE: "1", ALLOW_GATEWAY_SIMULATOR: "1", ALLOW_PRIVATE_WEBHOOKS: "true", JOBS_DISABLED: "1", AI_PROVIDER: "fake", PLATFORM_DOMAIN: "localhost", SESSION_SECRET: "setu-dev-secret-change-me" });
    for (const id of ["otp_dev", "simulator", "private_webhooks", "jobs", "ai", "platform_domain", "session_secret"]) expect(s[id], id).toBe("fail");
  });

  it("local storage needs a volume", () => {
    expect(status({ ...good, STORAGE_DRIVER: "" }).storage).toBe("fail");
    expect(status({ ...good, STORAGE_DRIVER: "", STORAGE_DIR: "/data/storage" }).storage).toBe("warn");
    expect(status({ ...good, S3_BUCKET: "" }).storage).toBe("fail");
  });

  it("database facts: role, migrations, worker", () => {
    const ok = { superuser: false, bypassRls: false, migrationsApplied: 21, migrationsInRepo: 21, workerLastJobMin: 2 };
    const s = (f: typeof ok | (Omit<typeof ok, "workerLastJobMin"> & { workerLastJobMin: number | null })) => dbChecks(f).map((c) => c.status);
    expect(s(ok)).toEqual(["ok", "ok", "ok"]);
    expect(s({ ...ok, superuser: true })[0]).toBe("fail");
    expect(s({ ...ok, bypassRls: true })[0]).toBe("fail");
    expect(s({ ...ok, migrationsApplied: 20 })[1]).toBe("fail");
    expect(s({ ...ok, workerLastJobMin: null })[2]).toBe("fail");
    expect(s({ ...ok, workerLastJobMin: 45 })[2]).toBe("fail");
  });

  it("reads the real database", async () => {
    const r = await goLiveReport({ ...good });
    const role = r.checks.find((c) => c.id === "db_role");
    expect(role?.status).toBe("ok"); // tests run as the app's non-superuser role
    expect(r.checks.find((c) => c.id === "migrations")?.status).toBe("ok");
  });
});
