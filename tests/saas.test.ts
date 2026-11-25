/**
 * Phase 9: plans, limits, sign-up, support sessions, billing, domains, data
 * export and deletion. Needs the seeded dev database. Every billing / purge
 * test runs on scratch businesses made here (runBilling(now, [ids]) leaves
 * the demo data alone); the scratch businesses are purged at the end, which
 * is itself the deletion test.
 */
import "dotenv/config";
import { gunzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { asPlatform, tenantDb, withTenantTx } from "@/lib/db";
import { gate } from "@/lib/guard";
import { checkLimit, entitlements, featureForPath, invalidateEntitlements, LimitError, mergeEntitlements, type Feature } from "@/lib/plans";
import { checkColours, contrast, DEFAULT_COLOURS, themeVars } from "@/lib/branding";
import { addMonth, billLines, billTax, choosePlan, markInvoicePaid, platformSeller, runBilling } from "@/lib/billing";
import { consumeWelcome, createTenantRecord, requestSignupOtp, signup, SignupError, verifySignupOtp } from "@/lib/signup";
import { activeSupport, consumeSupport, endSupport, startSupport, SupportError } from "@/lib/support";
import { addDomain, checkDomain, DomainError, domainProblem, normaliseDomain, removeDomain } from "@/lib/domains";
import { buildExport, KEEP_AFTER_PURGE, purgePlan, purgeTenant, tenantTables } from "@/lib/tenant-data";

process.env.OTP_DEV_MODE = "1";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const rand = () => Math.random().toString(36).slice(2, 8);
const scratch: string[] = [];
let demoId = "";
let secondId = "";
let platformUserId = "";

async function scratchTenant(planCode: string | null = null, now = new Date()) {
  const { tenant } = await asPlatform((tx) =>
    createTenantRecord(tx, { slug: `p9${rand()}`, name: `Phase 9 test ${rand()}`, stateCode: "27", planCode, now }, { name: "Owner", loginId: "owner", password: "Strong-pass-123" })
  );
  scratch.push(tenant.id);
  return tenant.id;
}

beforeAll(async () => {
  const [demo, second] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" } }),
    prisma.tenant.findUniqueOrThrow({ where: { slug: "second" } }),
  ]);
  demoId = demo.id;
  secondId = second.id;
  platformUserId = (await prisma.platformUser.create({ data: { name: "Test support", email: `p9-${rand()}@test.local`, passwordHash: "x", role: "SUPPORT" } })).id;
});

afterAll(async () => {
  for (const id of scratch) {
    const t = await asPlatform((tx) => tx.tenant.findUnique({ where: { id }, select: { status: true } }));
    if (t && t.status !== "CLOSED") await purgeTenant(id).catch(() => null);
  }
  await prisma.platformUser.delete({ where: { id: platformUserId } }).catch(() => null);
  await prisma.$disconnect();
});

// ───────────────────────────── pure rules ─────────────────────────────

describe("gate (pause, support, modules)", () => {
  const all = new Set<Feature>(["inventory", "field", "integrations"]);
  const base = { tenantStatus: "ACTIVE" as const, role: "ADMIN" as const, path: "/api/orders", method: "POST", support: null, features: all };

  it("lets a normal request through", () => expect(gate(base)).toBeNull());

  it("a supervisor login opens nothing on a plan without the field module", () => {
    const noField = new Set<Feature>(["inventory"]);
    expect(gate({ ...base, role: "SUPERVISOR" })).toBeNull();
    expect(gate({ ...base, role: "SUPERVISOR", features: noField })?.feature).toBe("field");
    expect(gate({ ...base, role: "SUPERVISOR", features: noField, path: "/api/field/attendance", method: "GET" })?.status).toBe(402);
    expect(gate({ ...base, role: "SALES_AGENT", features: noField })).toBeNull();
  });

  it("a paused business: only the owner, only billing / export / account", () => {
    expect(gate({ ...base, tenantStatus: "SUSPENDED" })?.status).toBe(423);
    expect(gate({ ...base, tenantStatus: "SUSPENDED", path: "/api/admin/billing" })).toBeNull();
    expect(gate({ ...base, tenantStatus: "SUSPENDED", path: "/api/admin/export/abc" })).toBeNull();
    expect(gate({ ...base, tenantStatus: "SUSPENDED", role: "SALES_AGENT", path: "/api/admin/billing" })?.status).toBe(423);
    // "/api/admin/billingx" is not under /api/admin/billing
    expect(gate({ ...base, tenantStatus: "SUSPENDED", path: "/api/admin/billingx" })?.status).toBe(423);
  });

  it("a read-only support session can read but not write", () => {
    const support = { mode: "READ" as const };
    expect(gate({ ...base, support })?.code).toBe("support_read_only");
    expect(gate({ ...base, support, method: "GET" })).toBeNull();
    expect(gate({ ...base, support, path: "/api/auth/support/end" })).toBeNull();
    expect(gate({ ...base, support: { mode: "WRITE" } })).toBeNull();
  });

  it("a module not in the plan answers 402 upgrade", () => {
    const r = gate({ ...base, path: "/api/bank/statements", features: all });
    expect(r).toMatchObject({ status: 402, code: "upgrade", feature: "bank" });
    expect(gate({ ...base, path: "/api/stock/lots" })).toBeNull();
  });

  it("maps paths to modules on segment boundaries", () => {
    expect(featureForPath("/admin/stock")).toBe("inventory");
    expect(featureForPath("/admin/stock/lots")).toBe("inventory");
    expect(featureForPath("/admin/stockists")).toBeNull();
    expect(featureForPath("/admin/books")).toBe("books");
    expect(featureForPath("/admin/books/gst")).toBe("books");
    expect(featureForPath("/api/admin/books/purchases/x")).toBe("books");
    expect(featureForPath("/admin/bookshelf")).toBeNull();
    expect(featureForPath("/api/v1/orders")).toBe("integrations");
    expect(featureForPath("/team/beats")).toBe("field");
    expect(featureForPath("/api/orders")).toBeNull();
    expect(featureForPath("/api/payments/webhook")).toBeNull();
  });
});

describe("entitlements merge", () => {
  it("overrides switch modules on and off and replace limits", () => {
    const e = mergeEntitlements(
      { code: "starter", name: "Starter", features: ["gateway", "bank", "nonsense"], limits: { staff: 10, retailers: 300 } },
      { features: { bank: false, inventory: true }, limits: { staff: 25 } }
    );
    expect([...e.features].sort()).toEqual(["gateway", "inventory"]);
    expect(e.limits).toEqual({ staff: 25, retailers: 300 });
  });
});

describe("brand colours", () => {
  it("our own colours pass every check", () => {
    expect(checkColours(DEFAULT_COLOURS)).toEqual([]);
  });

  it("refuses a main colour too light for white text and a dark surface", () => {
    const r = checkColours({ primary: "#ffd400", accent: DEFAULT_COLOURS.accent, surface: "#222222" });
    expect(r.map((x) => x.field).sort()).toEqual(expect.arrayContaining(["primary", "surface"]));
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("only hex values reach the CSS", () => {
    const v = themeVars({ primary: "#123456" } as never);
    expect(v["--mor"]).toBe("#123456");
    for (const val of Object.values(v)) expect(val).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("our invoice maths", () => {
  const plan = { name: "Growth", basePaise: 249_900, seatPaise: 14_900, retailerPaise: 400, aiCredits: 500, aiCreditPaise: 80 };

  it("bills base, seats, active shops and AI over the allowance", () => {
    const lines = billLines(plan, { seats: 3, retailers: 10, aiCredits: 600 }, "997331");
    expect(lines.map((l) => [l.code, l.qty, l.amountPaise])).toEqual([
      ["base", 1, 249_900],
      ["seats", 3, 44_700],
      ["retailers", 10, 4_000],
      ["ai", 100, 8_000],
    ]);
    expect(billLines(plan, { seats: 0, retailers: 0, aiCredits: 10 }, "997331").map((l) => l.code)).toEqual(["base"]);
  });

  it("GST only with our GSTIN: CGST + SGST in our state, IGST outside", () => {
    expect(billTax(100_000, "27", { ...platformSeller(), gstin: null })).toMatchObject({ cgst: 0, sgst: 0, igst: 0, total: 100_000 });
    const seller = { ...platformSeller(), gstin: "27AAAAA0000A1Z5", stateCode: "27" };
    expect(billTax(100_000, "27", seller)).toMatchObject({ interState: false, cgst: 9_000, sgst: 9_000, igst: 0, total: 118_000 });
    expect(billTax(100_000, "29", seller)).toMatchObject({ interState: true, cgst: 0, sgst: 0, igst: 18_000, total: 118_000 });
  });

  it("adds a calendar month in IST, keeping month ends", () => {
    const jan31 = new Date("2026-01-30T18:30:00Z"); // 31 Jan 00:00 IST
    expect(addMonth(jan31).toISOString()).toBe("2026-02-27T18:30:00.000Z"); // 28 Feb 00:00 IST
    const may15 = new Date("2026-05-15T04:30:00Z");
    expect(addMonth(may15).toISOString()).toBe("2026-06-15T04:30:00.000Z");
  });
});

describe("custom domain rules", () => {
  it("accepts a business domain and refuses ours and local names", () => {
    expect(normaliseDomain(" HTTPS://Order.Example-Shop.in/ ")).toBe("order.example-shop.in");
    expect(domainProblem("order.example-shop.in", "sellerssetu.in")).toBeNull();
    expect(domainProblem("x.sellerssetu.in", "sellerssetu.in")).toMatch(/our own/);
    expect(domainProblem("shop.localhost", "sellerssetu.in")).toMatch(/public/);
  });
});

describe("purge order", () => {
  it("deletes children first and breaks a nullable cycle", () => {
    const fk = (child: string, parent: string, nullable = false, onDelete = "a") => ({ child, parent, cols: [`${parent}Id`], nullable, onDelete });
    const p = purgePlan(["Order", "OrderItem", "Product", "Tenant"], [fk("OrderItem", "Order"), fk("OrderItem", "Product"), fk("Order", "Tenant"), fk("Product", "Tenant", false, "c")]);
    expect(p.order.indexOf("OrderItem")).toBeLessThan(p.order.indexOf("Order"));
    expect(p.order.indexOf("OrderItem")).toBeLessThan(p.order.indexOf("Product"));
    expect(p.order.indexOf("Order")).toBeLessThan(p.order.indexOf("Tenant"));
    const c = purgePlan(["A", "B"], [fk("A", "B", true), fk("B", "A")]);
    expect(c.nullify).toEqual([{ table: "A", cols: ["BId"] }]);
    expect(purgePlan(["U"], [fk("U", "U", true)]).nullify).toEqual([{ table: "U", cols: ["UId"] }]);
  });
});

// ───────────────────────────── against the database ─────────────────────────────

describe("sign-up", () => {
  it("phone code, then the business, a trial and a single-use welcome link", async () => {
    const phone = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
    const { challengeId, devCode } = await requestSignupOtp(phone, null);
    expect(devCode).toMatch(/^\d{6}$/);
    await expect(verifySignupOtp(challengeId, devCode === "000000" ? "111111" : "000000")).rejects.toThrow(SignupError);
    expect((await verifySignupOtp(challengeId, devCode!)).phone).toBe(phone);

    const slug = `p9s${rand()}`;
    const body = { businessName: "Test Traders", slug, stateCode: "27", ownerName: "Test Owner", loginId: "owner", password: "Strong-pass-123", acceptTerms: true, challengeId, planCode: "growth" };
    const { tenant, token } = await signup(body, null);
    scratch.push(tenant.id);
    expect(tenant.status).toBe("TRIAL");

    // The same verified code can't make a second business.
    await expect(signup({ ...body, slug: `p9s${rand()}` }, null)).rejects.toThrow(SignupError);
    // Nor the same address.
    await expect(signup({ ...body }, null)).rejects.toThrow(SignupError);

    const sub = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: tenant.id } }));
    expect(sub).toMatchObject({ status: "TRIAL", planCode: "trial", nextPlanCode: "growth" });
    // During the trial the business tries the plan it picked.
    invalidateEntitlements(tenant.id);
    expect((await entitlements(tenant.id)).planCode).toBe("growth");

    const owner = await consumeWelcome(token, tenant.id);
    expect(owner.role).toBe("ADMIN");
    await expect(consumeWelcome(token, tenant.id)).rejects.toThrow(/already used/);
    await expect(consumeWelcome(token, demoId)).rejects.toThrow(SignupError);
  });
});

describe("usage limits", () => {
  it("refuses a staff login over the plan's limit", async () => {
    const id = await scratchTenant();
    await asPlatform((tx) => tx.tenant.update({ where: { id }, data: { overrides: { limits: { staff: 1 } } } }));
    invalidateEntitlements(id);
    await expect(withTenantTx(id, (tx) => checkLimit(tx, id, "staff"))).rejects.toThrow(LimitError);
    await expect(withTenantTx(id, (tx) => checkLimit(tx, id, "retailers", 5))).resolves.toBeUndefined();
  });
});

describe("support sessions", () => {
  it("single-use sign-in link, visible to the business, ends on request", async () => {
    const id = await scratchTenant();
    await expect(startSupport({ platformUserId, platformUserName: "Test", tenantId: id, reason: "hi" })).rejects.toThrow(SupportError);
    const { session, token } = await startSupport({ platformUserId, platformUserName: "Test", tenantId: id, reason: "Checking an order total", mode: "READ", minutes: 15 });
    const used = await consumeSupport(token, id);
    expect(used.session.id).toBe(session.id);
    await expect(consumeSupport(token, id)).rejects.toThrow(SupportError);
    await expect(consumeSupport(token, demoId)).rejects.toThrow(SupportError);

    // The support login is not a seat and is hidden from the team list's count.
    const seats = await withTenantTx(id, (tx) => tx.user.count({ where: { active: true, isSupport: false, role: { not: "RETAILER" } } }));
    expect(seats).toBe(1);
    expect(await tenantDb(id).auditLog.count({ where: { action: "support.start" } })).toBe(1);

    expect(await activeSupport(id, session.id)).not.toBeNull();
    await endSupport(id, session.id, "owner");
    expect(await activeSupport(id, session.id)).toBeNull();
    // And it is gone once the time is up.
    const s2 = await startSupport({ platformUserId, platformUserName: "Test", tenantId: id, reason: "Second look at it", minutes: 5 });
    expect(await activeSupport(id, s2.session.id, new Date(Date.now() + 6 * 60_000))).toBeNull();
  });
});

describe("billing run", () => {
  it("trial → picked plan → invoice → overdue pause → paid un-pauses", async () => {
    const start = new Date();
    const id = await scratchTenant(null, start);
    await choosePlan(id, "starter", start);
    const sub0 = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    expect(sub0).toMatchObject({ status: "TRIAL", nextPlanCode: "starter" });

    const trialEnd = sub0.trialEndsAt!;
    const r1 = await runBilling(new Date(trialEnd.getTime() + HOUR), [id]);
    expect(r1.trialsConverted).toBe(1);
    const sub1 = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    expect(sub1).toMatchObject({ status: "ACTIVE", planCode: "starter", nextPlanCode: null });
    expect(sub1.periodStart.getTime()).toBe(trialEnd.getTime());

    const r2 = await runBilling(new Date(sub1.periodEnd.getTime() + HOUR), [id]);
    expect(r2.invoiced).toBe(1);
    const inv = await asPlatform((tx) => tx.platformInvoice.findFirstOrThrow({ where: { tenantId: id } }));
    expect(inv.number).toMatch(/^SS\/\d{4}-\d{2}-\d{5}$|^SS\/[\w-]+-\d{5}$/);
    expect(inv.status).toBe("ISSUED");
    expect(inv.taxable).toBe(99_900 + 9_900); // base + the owner's seat
    // Running again issues nothing new (idempotent).
    expect((await runBilling(new Date(sub1.periodEnd.getTime() + 2 * HOUR), [id])).invoiced).toBe(0);
    // Amounts are fixed once issued.
    await expect(asPlatform((tx) => tx.platformInvoice.update({ where: { id: inv.id }, data: { total: 1 } }))).rejects.toThrow();

    const late = new Date(inv.dueAt.getTime() + 15 * DAY);
    const r3 = await runBilling(late, [id]);
    expect(r3.suspended).toBe(1);
    const paused = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id }, select: { status: true, suspendReason: true } }));
    expect(paused.status).toBe("SUSPENDED");
    expect(paused.suspendReason).toMatch(/^billing:unpaid/);

    for (const open of await asPlatform((tx) => tx.platformInvoice.findMany({ where: { tenantId: id, status: "ISSUED" } }))) {
      await markInvoicePaid(open.id, { ref: "TEST-UTR", via: "bank transfer", at: late });
    }
    const back = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id }, select: { status: true, suspendReason: true } }));
    expect(back).toEqual({ status: "ACTIVE", suspendReason: null });
    const sub3 = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    expect(sub3.status).toBe("ACTIVE");
  });

  it("a trial that ends without a plan: past due, paused after the grace, back on picking a plan", async () => {
    const id = await scratchTenant();
    const sub = await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }));
    const end = sub.trialEndsAt!;
    expect((await runBilling(new Date(end.getTime() + HOUR), [id])).trialsLapsed).toBe(1);
    expect((await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }))).status).toBe("PAST_DUE");
    expect((await runBilling(new Date(end.getTime() + 8 * DAY), [id])).suspended).toBe(1);
    expect((await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id } }))).suspendReason).toBe("billing:trial-ended");

    await choosePlan(id, "growth", new Date(end.getTime() + 8 * DAY + HOUR));
    const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id }, select: { status: true, plan: true } }));
    expect(t).toEqual({ status: "ACTIVE", plan: "growth" });
  });
});

describe("custom domains", () => {
  it("verifies through the TXT record, refuses a host another business has", async () => {
    const id = await scratchTenant();
    const host = `order-${rand()}.example-shop.in`;
    const d = await addDomain(id, host.toUpperCase());
    expect(d.host).toBe(host);
    await expect(addDomain(id, host)).rejects.toThrow(DomainError);
    // An unverified claim can't squat the address: another business may claim it too, with its own code.
    const rival = await addDomain(demoId, host);
    expect(rival.token).not.toBe(d.token);

    const wrong = await checkDomain(id, d.id, async () => [["something-else"]]);
    expect(wrong.verifiedAt).toBeNull();
    expect(wrong.lastError).toMatch(/_setu-verify/);
    // The real owner proves it first: theirs, and the rival's claim is dropped.
    const ok = await checkDomain(id, d.id, async (name) => (name === `_setu-verify.${host}` ? [[d.token.slice(0, 5), d.token.slice(5)]] : []));
    expect(ok.verifiedAt).not.toBeNull();
    expect(ok.verifiedHost).toBe(host);
    expect(ok.lastError).toBeNull();
    expect(await asPlatform((tx) => tx.tenantDomain.count({ where: { id: rival.id } }))).toBe(0);
    await expect(addDomain(demoId, host)).rejects.toThrow(/another business/);

    await expect(checkDomain(demoId, d.id, async () => [])).rejects.toThrow(/not found/);
    await removeDomain(id, d.id);
    expect(await asPlatform((tx) => tx.tenantDomain.count({ where: { id: d.id } }))).toBe(0);
  });
});

describe("new tables stay per business", () => {
  it("a business sees only its own subscription, invoices and usage", async () => {
    const subs = await tenantDb(secondId).subscription.findMany();
    expect(subs.every((s) => s.tenantId === secondId)).toBe(true);
    expect(await tenantDb(secondId).platformInvoice.count({ where: { tenantId: demoId } })).toBe(0);
    expect(await tenantDb(secondId).usageCounter.count({ where: { tenantId: demoId } })).toBe(0);
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.platformInvoice.count()).toBe(0);
  });
});

describe("export and deletion", () => {
  it("exports without secrets, then purges every row but our own records", async () => {
    const id = await scratchTenant();
    await withTenantTx(id, async (tx) => {
      const area = await tx.region.create({ data: { name: "Test region", areas: { create: { name: "Test area" } } }, include: { areas: true } });
      await tx.user.create({ data: { name: "Test shop", phone: "9000099999", role: "RETAILER", retailerProfile: { create: { outletName: "Test shop", shopNumber: "1", complexName: "Test market", pinCode: "400001", areaId: area.areas[0].id } } } });
      await tx.auditLog.create({ data: { action: "test.row", entity: "Test" } });
    });

    const { bytes, rows } = await buildExport(id);
    const doc = JSON.parse(gunzipSync(bytes).toString("utf8"));
    expect(doc.format).toBe("setu-export/1");
    expect(rows).toBeGreaterThan(3);
    expect(doc.tables.User.length).toBe(2);
    expect(JSON.stringify(doc)).not.toContain("passwordHash");
    expect(doc.tables.RetailerProfile[0].outletName).toBe("Test shop");

    await purgeTenant(id);
    const left: Record<string, number> = {};
    for (const table of await tenantTables()) {
      if (KEEP_AFTER_PURGE.has(table)) continue;
      const [{ n }] = await asPlatform((tx) => tx.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${table}" WHERE "tenantId" = $1`, id));
      if (n) left[table] = n;
    }
    expect(left).toEqual({});
    const t = await asPlatform((tx) => tx.tenant.findUniqueOrThrow({ where: { id } }));
    expect(t.status).toBe("CLOSED");
    expect(t.slug).toMatch(/^closed-/);
    expect((await asPlatform((tx) => tx.subscription.findUniqueOrThrow({ where: { tenantId: id } }))).status).toBe("CANCELLED");
  });
});
