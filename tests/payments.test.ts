/**
 * Phase 8 against the real database: the payment gateway (practice provider
 * and Razorpay with a stubbed API and signed webhooks), settlements and fees,
 * bank statement import and matching, API keys and the read-only API,
 * outbound webhooks to a local server (signature, retries, giving up), maps
 * fallbacks, and tenant isolation of the new tables.
 *
 * Fresh shops in the demo tenant; settings restored afterwards.
 */
import "dotenv/config";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { tenantDb, withTenantTx } from "@/lib/db";
import { balanceOf, openingBalance, recordPayment, withMoney } from "@/lib/ledger";
import { placeOrder } from "@/lib/order-place";
import { CART_DEFAULTS } from "@/lib/cart-settings";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { gatewayOn, gatewaySettings, parseGatewaySettings, publicGateway, GATEWAY_DEFAULTS } from "@/lib/gateway-settings";
import { signWebhook, validWebhook } from "@/lib/razorpay";
import { applyGatewayPayment, cancelIntent, createIntent, handleRazorpayWebhook, simulatePay, syncOpen } from "@/lib/gateway";
import { importStatement, ignoreLine, lineHasRef, matchLine, parseBankAmount, parseBankDate, parseStatement, refsIn, unmatchLine } from "@/lib/bank";
import { checkKey, keyFrom, makeKey, parseScopes } from "@/lib/api-keys";
import { listResource } from "@/lib/public-api";
import { BACKOFF_MINUTES, checkWebhookUrl, flushWebhooks, MAX_ATTEMPTS, sign, WEBHOOK_EVENTS } from "@/lib/webhooks";
import { estimateRoute, mapsProvider, straightLeg } from "@/lib/maps";
import { km, twoOpt } from "@/lib/trips";
import { can } from "@/lib/permissions";

const run = Date.now().toString().slice(-6);
const phone = (n: number) => `7${run}${String(n).padStart(3, "0")}`;
let T = "";
let T2 = "";
let original: unknown = null;
let adminId = "";
let productId = "";
const shop = { a: "", b: "", c: "", d: "" };
const user = { a: "", b: "", c: "", d: "" };
const WH_SECRET = `whsec_test_${run}`;

const as = <X>(who: string | null, fn: Parameters<typeof withMoney<X>>[2]) => withMoney(T, who, fn);
const bal = (type: "GATEWAY_CLEARING" | "GATEWAY_FEES" | "BANK" | "UPI_CLEARING" | "OFFICE_CASH" | "CHEQUES_IN_HAND") => as(null, (ctx) => balanceOf(ctx, { type }));
const owed = (retailerId: string) => as(null, (ctx) => balanceOf(ctx, { type: "RECEIVABLE", retailerId }));

async function setGateway(patch: Record<string, unknown>) {
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  const s = (t.settings ?? {}) as Record<string, unknown>;
  await prisma.tenant.update({ where: { id: T }, data: { settings: { ...s, gateway: { ...GATEWAY_DEFAULTS, ...patch } } as object } });
}

async function mkShop(n: number, extra: { gstin?: string } = {}) {
  const db = tenantDb(T);
  const areaId = (await db.area.findFirstOrThrow({ orderBy: { name: "asc" } })).id;
  const r = await db.user.create({
    data: {
      name: `Pay shop ${run}-${n}`,
      phone: phone(n),
      role: "RETAILER",
      retailerProfile: { create: { outletName: `Paytest Kirana ${run}${n}`, shopNumber: "1", complexName: "Test", pinCode: "400001", areaId, gstin: extra.gstin ?? null, paymentMode: "POSTPAID" } },
    },
    include: { retailerProfile: true },
  });
  return { userId: r.id, shopId: r.retailerProfile!.id };
}

beforeAll(async () => {
  const demo = await prisma.tenant.findUniqueOrThrow({ where: { slug: "demo" }, select: { id: true, settings: true } });
  T = demo.id;
  original = demo.settings;
  T2 = (await prisma.tenant.findUniqueOrThrow({ where: { slug: "second" }, select: { id: true } })).id;
  const db = tenantDb(T);
  adminId = (await db.user.findFirstOrThrow({ where: { role: "ADMIN", active: true } })).id;
  productId = (await db.product.findFirstOrThrow({ where: { active: true, sku: "BEV-001" } })).id;
  for (const [k, n] of [["a", 1], ["b", 2], ["c", 3], ["d", 4]] as const) {
    const s = await mkShop(n);
    shop[k] = s.shopId;
    user[k] = s.userId;
    await as(adminId, (ctx) => openingBalance(ctx, s.shopId, 100_000, new Date(Date.now() - 86_400_000)));
  }
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: T },
    data: { settings: { ...(t.settings as object), cart: { ...CART_DEFAULTS, minOrderValue: 0, deliveryCharge: 0, freeDeliveryAbove: 0, closedWeekdays: [], holidays: [], cutoffTime: "23:59" } } as object },
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  if (T) {
    await prisma.tenant.update({ where: { id: T }, data: { settings: original as object } });
    await tenantDb(T).webhookEndpoint.deleteMany({ where: { description: `test ${run}` } });
    await tenantDb(T).user.updateMany({ where: { id: { in: Object.values(user).filter(Boolean) } }, data: { active: false } });
  }
});

// ───────────────────────────── pure parts ─────────────────────────────

describe("secrets, settings and signatures", () => {
  it("encrypts secrets and refuses a tampered one", () => {
    const s = encryptSecret("abc123secret");
    expect(s).toMatch(/^v1:/);
    expect(s).not.toContain("abc123secret");
    expect(decryptSecret(s)).toBe("abc123secret");
    const parts = s.split(":");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("A") ? "BB" : "AA");
    expect(decryptSecret(parts.join(":"))).toBeNull();
    expect(decryptSecret("")).toBeNull();
  });

  it("checks gateway settings and never shows secrets", () => {
    expect(parseGatewaySettings({ provider: "paypal" })).toBeTypeOf("string");
    expect(parseGatewaySettings({ keyId: "sk_live_x" })).toMatch(/rzp_/);
    expect(parseGatewaySettings({ linkDays: 0 })).toBeTypeOf("string");
    const p = parseGatewaySettings({ provider: "razorpay", keyId: "rzp_test_ABCDEFGH12", keySecret: "s3cr3t-key-1234", webhookSecret: "" });
    expect(p).toMatchObject({ provider: "razorpay", keyId: "rzp_test_ABCDEFGH12", newKeySecret: "s3cr3t-key-1234" });
    expect(p).not.toHaveProperty("newWebhookSecret");
    const g = gatewaySettings({ gateway: { provider: "razorpay", keyId: "rzp_live_ABCDEFGH12", keySecret: encryptSecret("x") } });
    const pub = publicGateway(g);
    expect(pub).toMatchObject({ mode: "live", hasKeySecret: true, hasWebhookSecret: false });
    expect(JSON.stringify(pub)).not.toContain("v1:");
    expect(gatewayOn(g)).toBe(true);
    expect(gatewayOn(gatewaySettings({}))).toBe(false);
  });

  it("verifies Razorpay webhook signatures in constant time", () => {
    const body = '{"event":"payment.captured"}';
    const sig = signWebhook(body, "sec");
    expect(validWebhook(body, sig, "sec")).toBe(true);
    expect(validWebhook(body + " ", sig, "sec")).toBe(false);
    expect(validWebhook(body, sig, "other")).toBe(false);
    expect(validWebhook(body, null, "sec")).toBe(false);
  });

  it("gives the new permissions to the admin only", () => {
    for (const p of ["gateway.manage", "bank.reconcile", "integrations.manage"] as const) {
      expect(can("ADMIN", p)).toBe(true);
      expect(can("SALES_AGENT", p)).toBe(false);
      expect(can("RETAILER", p)).toBe(false);
    }
  });
});

describe("bank statement parsing", () => {
  it("reads Indian dates and amounts", () => {
    const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
    expect(ist(parseBankDate("05/11/2026")!)).toBe("2026-11-05");
    expect(ist(parseBankDate("5-Nov-2026")!)).toBe("2026-11-05");
    expect(ist(parseBankDate("05 Nov 26")!)).toBe("2026-11-05");
    expect(ist(parseBankDate("2026-11-05")!)).toBe("2026-11-05");
    expect(ist(parseBankDate("46331")!)).toBe("2026-11-05");
    expect(parseBankDate("31/02/2026")).toBeNull();
    expect(parseBankDate("Opening balance")).toBeNull();
    expect(parseBankAmount("1,23,456.70")).toBe(12_345_670);
    expect(parseBankAmount("500 Cr")).toBe(50_000);
    expect(parseBankAmount("500.5 Dr")).toBe(-50_050);
    expect(parseBankAmount("(20.00)")).toBe(-2_000);
    expect(parseBankAmount("₹ 99")).toBe(9_900);
    expect(parseBankAmount("")).toBe(0);
    expect(parseBankAmount("abc")).toBeNull();
  });

  it("finds UTR / RRN references and matches cheque numbers as whole tokens", () => {
    expect(refsIn("UPI/633412345678/Paid to shop/okaxis")).toContain("633412345678");
    expect(refsIn("NEFT-HDFCN52026111912345-SHREE STORES")).toContain("HDFCN52026111912345");
    const line = { narration: "CLG CHQ 004521 SHREE", reference: null };
    expect(lineHasRef(line, "4521")).toBe(true);
    expect(lineHasRef(line, "452")).toBe(false);
    expect(lineHasRef({ narration: "UPI/633412345678/x", reference: null }, "1234")).toBe(false);
    expect(lineHasRef({ narration: "IMPS633412345678x", reference: null }, "633412345678")).toBe(true);
  });

  it("finds the header below the account details, with debit / credit columns", async () => {
    const csv = [
      "Account Statement,,,,,",
      "Account No,XXXX1234,,,,",
      ",,,,,",
      "Txn Date,Value Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
      "01/11/2026,01/11/2026,UPI/633400000001/shop,633400000001,,1500.00,10000.00",
      "02/11/2026,02/11/2026,ATM WDL,,2000.00,,8000.00",
      "Statement summary,,,,,,",
    ].join("\n");
    const p = await parseStatement(Buffer.from(csv), "s.csv");
    expect(p.lines).toHaveLength(2);
    expect(p.lines[0]).toMatchObject({ credit: 150_000, debit: 0, reference: "633400000001", balance: 1_000_000 });
    expect(p.lines[1]).toMatchObject({ credit: 0, debit: 200_000 });
    expect(p.skipped).toBe(1);
  });

  it("reads an amount + Dr/Cr layout and refuses a file without the columns", async () => {
    const csv = ["Date,Description,Amount,Dr/Cr", "03-11-2026,NEFT IN,2500,CR", "03-11-2026,CHARGES,10,DR"].join("\n");
    const p = await parseStatement(Buffer.from(csv), "s.csv");
    expect(p.lines.map((l) => [l.credit, l.debit])).toEqual([[250_000, 0], [0, 1_000]]);
    await expect(parseStatement(Buffer.from("a,b\n1,2"), "x.csv")).rejects.toThrow(/columns/);
    await expect(parseStatement(Buffer.from("x"), "x.pdf")).rejects.toThrow(/CSV or Excel/);
  });
});

describe("routes and maps", () => {
  it("2-opt never makes a nearest-neighbour path longer", () => {
    const start = { lat: 19.0, lng: 72.8 };
    const pts = [
      { lat: 19.0, lng: 72.9 },
      { lat: 19.1, lng: 72.8 },
      { lat: 19.0, lng: 72.95 },
      { lat: 19.12, lng: 72.82 },
      { lat: 19.05, lng: 72.86 },
    ];
    const len = (p: typeof pts) => p.reduce((s, x, i) => s + km(i ? p[i - 1] : start, x), 0);
    const out = twoOpt(pts, start);
    expect(out).toHaveLength(pts.length);
    expect(len(out)).toBeLessThanOrEqual(len(pts) + 1e-9);
  });

  it("falls back to straight line × 1.3 at 20 km/h without a provider", async () => {
    expect(mapsProvider()).toBe("none");
    const a = { lat: 19.0, lng: 72.8 };
    const b = { lat: 19.1, lng: 72.8 };
    const leg = straightLeg(a, b);
    expect(leg.km).toBeCloseTo(km(a, b) * 1.3, 0);
    const est = await estimateRoute(T, [a, b, a]);
    expect(est.provider).toBe("none");
    expect(est.legs).toHaveLength(2);
    expect(est.totalMinutes).toBe(leg.minutes * 2);
  });
});

// ───────────────────────────── gateway ─────────────────────────────

describe("practice gateway", () => {
  it("is off until set up", async () => {
    await setGateway({ provider: "none" });
    await expect(createIntent(T, user.a, { kind: "LINK", retailerId: shop.a })).rejects.toThrow(/not set up/);
  });

  it("makes a link for all dues, reuses it, and books part and then the rest", async () => {
    await setGateway({ provider: "simulator", acceptPartial: true });
    const clearing0 = await bal("GATEWAY_CLEARING");
    const i = await createIntent(T, user.a, { kind: "LINK", retailerId: shop.a });
    expect(i).toMatchObject({ amount: 100_000, status: "CREATED", provider: "simulator" });
    expect(i.shortUrl).toContain(`/pay/sim/${i.id}`);
    expect((await createIntent(T, user.a, { kind: "LINK", retailerId: shop.a })).id).toBe(i.id);

    expect(await simulatePay(T, i.id, 40_000)).toBe("recorded");
    let row = await tenantDb(T).paymentIntent.findUniqueOrThrow({ where: { id: i.id } });
    expect(row).toMatchObject({ status: "PARTIAL", paidAmount: 40_000 });
    expect(await owed(shop.a)).toBe(60_000);
    await expect(simulatePay(T, i.id, 70_000)).rejects.toThrow(/Pay up to/);
    expect(await simulatePay(T, i.id)).toBe("recorded");
    row = await tenantDb(T).paymentIntent.findUniqueOrThrow({ where: { id: i.id } });
    expect(row.status).toBe("PAID");
    expect(await owed(shop.a)).toBe(0);
    expect((await bal("GATEWAY_CLEARING")) - clearing0).toBe(100_000);

    const pays = await tenantDb(T).payment.findMany({ where: { intentId: i.id } });
    expect(pays).toHaveLength(2);
    expect(pays.every((p) => p.method === "ONLINE" && p.state === "CONFIRMED" && p.collectedById === null)).toBe(true);
    // The same gateway payment again is not booked twice.
    expect(await as(null, (ctx) => applyGatewayPayment(ctx, { intentId: i.id, payment: { id: pays[0].gatewayPaymentId!, amount: 40_000, status: "captured" } }))).toBe("duplicate");
    await expect(simulatePay(T, i.id)).rejects.toThrow(/closed/);
  });

  it("asks for nothing when nothing is due, and the order QR asks for what is left on the order", async () => {
    await expect(createIntent(T, user.a, { kind: "LINK", retailerId: shop.a })).rejects.toThrow(/Nothing to pay/);
    const { order } = await as(user.b, (ctx) => placeOrder(ctx, { retailerId: shop.b, placedById: user.b, items: [{ productId, quantity: 2 }] }));
    const qr = await createIntent(T, adminId, { kind: "QR", retailerId: shop.b, orderId: order.id });
    expect(qr.amount).toBe(order.totalAmount);
    expect(qr.orderId).toBe(order.id);
    await expect(createIntent(T, adminId, { kind: "QR", retailerId: shop.a, orderId: order.id })).rejects.toThrow(/not this shop/);
    // Cancel, then it cannot be paid.
    const c = await cancelIntent(T, adminId, qr.id);
    expect(c.status).toBe("CANCELLED");
    await expect(simulatePay(T, qr.id)).rejects.toThrow(/closed/);
  });

  it("expires old open requests in the sweep", async () => {
    const i = await createIntent(T, adminId, { kind: "LINK", retailerId: shop.c, amount: 5_000 });
    await syncOpen(T, new Date(i.expiresAt.getTime() + 60_000));
    expect((await tenantDb(T).paymentIntent.findUniqueOrThrow({ where: { id: i.id } })).status).toBe("EXPIRED");
  });
});

describe("Razorpay (stubbed API, signed webhooks)", () => {
  let intentId = "";
  const calls: { url: string; body: unknown }[] = [];

  beforeAll(async () => {
    await setGateway({ provider: "razorpay", keyId: "rzp_test_ABCDEFGH12", keySecret: encryptSecret("key-secret-123456"), webhookSecret: encryptSecret(WH_SECRET) });
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.endsWith("/payment_links") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: `plink_${run}`, short_url: `https://rzp.io/i/${run}`, status: "created", amount: body.amount, amount_paid: 0 }), { status: 200 });
      }
      if (url.includes("/payment_links/") && init?.method === "GET") {
        return new Response(JSON.stringify({ id: `plink_${run}`, short_url: "x", status: "paid", amount: 100_000, amount_paid: 100_000, payments: [{ payment_id: `pay_${run}`, amount: 100_000, status: "captured" }] }), { status: 200 });
      }
      if (url.includes("/payments/pay_")) {
        return new Response(JSON.stringify({ id: `pay_${run}`, amount: 100_000, status: "captured", method: "upi", acquirer_data: { rrn: `9${run}12345` } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { description: "not stubbed" } }), { status: 400 });
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("creates a link with our id as reference, no gateway SMS, and the shop's number", async () => {
    const i = await createIntent(T, user.c, { kind: "LINK", retailerId: shop.c });
    intentId = i.id;
    expect(i).toMatchObject({ provider: "razorpay", providerRef: `plink_${run}`, shortUrl: `https://rzp.io/i/${run}`, amount: 100_000 });
    const req = calls.find((c) => c.url.endsWith("/payment_links"))!.body as Record<string, unknown>;
    expect(req).toMatchObject({ amount: 100_000, currency: "INR", reference_id: i.id, notify: { sms: false, email: false } });
    expect((req.customer as { contact?: string }).contact).toBe(`+91${phone(3)}`);
    expect((req.notes as Record<string, string>).setu_intent).toBe(i.id);
  });

  const paidBody = () =>
    JSON.stringify({
      event: "payment_link.paid",
      payload: {
        payment_link: { entity: { id: `plink_${run}`, reference_id: intentId, status: "paid" } },
        payment: { entity: { id: `pay_${run}`, amount: 100_000, status: "captured", method: "upi", acquirer_data: { rrn: `9${run}12345` }, created_at: Math.floor(Date.now() / 1000) } },
      },
    });

  it("refuses an unsigned or wrongly signed webhook", async () => {
    const raw = paidBody();
    expect((await handleRazorpayWebhook(T, raw, null, "evt_x")).http).toBe(401);
    expect((await handleRazorpayWebhook(T, raw, signWebhook(raw, "wrong"), "evt_x")).http).toBe(401);
    expect(await tenantDb(T).payment.count({ where: { gatewayPaymentId: `pay_${run}` } })).toBe(0);
  });

  it("books a signed payment once, however often it is delivered", async () => {
    const raw = paidBody();
    const sig = signWebhook(raw, WH_SECRET);
    const r1 = await handleRazorpayWebhook(T, raw, sig, `evt_${run}_1`);
    expect(r1).toMatchObject({ http: 200, body: { status: "PROCESSED" } });
    const again = await handleRazorpayWebhook(T, raw, sig, `evt_${run}_1`);
    expect(again.body).toMatchObject({ duplicate: true });
    // A different event about the same payment (e.g. payment.captured) books nothing more.
    const r3 = await handleRazorpayWebhook(T, raw, sig, `evt_${run}_2`);
    expect(r3.body).toMatchObject({ status: "IGNORED" });
    const pays = await tenantDb(T).payment.findMany({ where: { gatewayPaymentId: `pay_${run}` } });
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ amount: 100_000, method: "ONLINE", reference: `9${run}12345` });
    expect(await owed(shop.c)).toBe(0);
    expect((await tenantDb(T).paymentIntent.findUniqueOrThrow({ where: { id: intentId } })).status).toBe("PAID");
    const ev = await tenantDb(T).gatewayEvent.findMany({ where: { eventId: { startsWith: `evt_${run}` } } });
    expect(ev.map((e) => e.status).sort()).toEqual(["IGNORED", "PROCESSED"]);
  });

  it("ignores events that are not ours and books a settlement with its fee once", async () => {
    const other = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_other", amount: 500, status: "captured", notes: [] } } } });
    expect((await handleRazorpayWebhook(T, other, signWebhook(other, WH_SECRET), `evt_${run}_3`)).body).toMatchObject({ status: "IGNORED" });

    const [clear0, bank0, fees0] = [await bal("GATEWAY_CLEARING"), await bal("BANK"), await bal("GATEWAY_FEES")];
    const s = JSON.stringify({ event: "settlement.processed", payload: { settlement: { entity: { id: `setl_${run}`, amount: 97_640, fees: 2_360, tax: 360, utr: `UTIB${run}000123`, created_at: Math.floor(Date.now() / 1000), status: "processed" } } } });
    expect((await handleRazorpayWebhook(T, s, signWebhook(s, WH_SECRET), `evt_${run}_4`)).body).toMatchObject({ status: "PROCESSED" });
    expect((await handleRazorpayWebhook(T, s, signWebhook(s, WH_SECRET), `evt_${run}_5`)).body).toMatchObject({ status: "IGNORED" });
    expect((await bal("BANK")) - bank0).toBe(97_640);
    expect((await bal("GATEWAY_FEES")) - fees0).toBe(2_360);
    expect((await bal("GATEWAY_CLEARING")) - clear0).toBe(-100_000);
  });
});

// ───────────────────────────── bank matching ─────────────────────────────

describe("bank statement matching", () => {
  const rrnPending = `61${run}0001`;
  const rrnUpi = `61${run}0002`;
  const chq = `${run}`;
  let pendingId = "";
  let upiId = "";
  let chequeId = "";
  let statementId = "";

  it("imports, matches the sure lines and suggests the rest", async () => {
    await setGateway({ provider: "none" });
    const [bank0, upi0, cash0, chq0] = [await bal("BANK"), await bal("UPI_CLEARING"), await bal("OFFICE_CASH"), await bal("CHEQUES_IN_HAND")];
    // A shop reported a UPI payment (waiting); the office took a UPI payment and a cheque.
    pendingId = (await as(user.d, (ctx) => recordPayment(ctx, { retailerId: shop.d, amount: 12_345, method: "UPI", reference: rrnPending, needsVerification: true }))).id;
    upiId = (await as(adminId, (ctx) => recordPayment(ctx, { retailerId: shop.d, amount: 23_456, method: "UPI", reference: rrnUpi, atOffice: true }))).id;
    const chp = await as(adminId, (ctx) => recordPayment(ctx, { retailerId: shop.d, amount: 34_567, method: "CHEQUE", cheque: { number: chq, bank: "SBI", date: new Date() }, atOffice: true }));
    chequeId = chp.cheque!.id;

    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const csv = [
      "Date,Narration,Ref No,Debit,Credit,Balance",
      `${today},UPI/${rrnPending}/from shop ${run},,,123.45,`,
      `${today},UPI/${rrnUpi}/office upi ${run},,,234.56,`,
      `${today},CLG CHQ ${chq} SBI ${run},${chq},,345.67,`,
      `${today},BY CASH DEPOSIT ${run},,,500.00,`,
      `${today},IMPS from ${phone(4)} ${run},,,77.00,`,
      `${today},CHARGES ${run},,11.80,,`,
    ].join("\n");
    const r = await importStatement(T, adminId, { fileName: `stmt-${run}.csv`, account: "Test current", bytes: Buffer.from(csv) });
    statementId = r.statement.id;
    expect(r.statement.lineCount).toBe(6);
    expect(r.matched).toBe(3);

    const lines = await tenantDb(T).bankLine.findMany({ where: { statementId }, orderBy: { credit: "asc" } });
    const by = (credit: number) => lines.find((l) => l.credit === credit)!;
    expect(by(12_345)).toMatchObject({ status: "MATCHED", matchKind: "VERIFY", matchRef: pendingId });
    expect(by(23_456)).toMatchObject({ status: "MATCHED", matchKind: "UPI_CLEAR", matchRef: upiId });
    expect(by(34_567)).toMatchObject({ status: "MATCHED", matchKind: "CHEQUE_CLEAR", matchRef: chequeId });
    expect(by(50_000).status).toBe("SUGGESTED");
    expect((by(50_000).suggestions as { kind: string }[]).map((s) => s.kind)).toContain("CASH_DEPOSIT");
    const imps = by(7_700);
    expect(imps.status).toBe("SUGGESTED");
    expect((imps.suggestions as { kind: string; retailerId?: string }[]).find((s) => s.kind === "NEW_PAYMENT")?.retailerId).toBe(shop.d);
    // Money out is never matched on its own; bank charges are suggested as an expense.
    const charges = lines.find((l) => l.debit > 0)!;
    expect(charges.status).toBe("SUGGESTED");
    expect((charges.suggestions as { kind: string }[]).map((x) => x.kind)).toEqual(["NEW_EXPENSE"]);

    expect((await tenantDb(T).payment.findUniqueOrThrow({ where: { id: pendingId } })).state).toBe("CONFIRMED");
    expect((await tenantDb(T).cheque.findUniqueOrThrow({ where: { id: chequeId } })).status).toBe("CLEARED");
    // Bank got the UPI pair and the cheque; UPI-to-be-banked and cheques in hand are back where they were.
    expect((await bal("BANK")) - bank0).toBe(12_345 + 23_456 + 34_567);
    expect((await bal("UPI_CLEARING")) - upi0).toBe(0);
    expect((await bal("CHEQUES_IN_HAND")) - chq0).toBe(0);
    expect((await bal("OFFICE_CASH")) - cash0).toBe(0);

    // The same file again adds nothing.
    const again = await importStatement(T, adminId, { fileName: `stmt-${run}.csv`, account: "Test current", bytes: Buffer.from(csv) });
    expect(again.duplicates).toBe(6);
    expect(again.statement.lineCount).toBe(0);
  });

  it("matches by hand, refuses a second match of the same thing, and sets lines aside", async () => {
    const lines = await tenantDb(T).bankLine.findMany({ where: { statementId } });
    const cash = lines.find((l) => l.credit === 50_000)!;
    const imps = lines.find((l) => l.credit === 7_700)!;
    const upi = lines.find((l) => l.credit === 23_456)!;
    const cash0 = await bal("OFFICE_CASH");
    await matchLine(T, adminId, cash.id, { kind: "CASH_DEPOSIT" });
    expect((await bal("OFFICE_CASH")) - cash0).toBe(-50_000);
    await expect(matchLine(T, adminId, cash.id, { kind: "CASH_DEPOSIT" })).rejects.toThrow(/already matched/);

    const owed0 = await owed(shop.d);
    const m = await matchLine(T, adminId, imps.id, { kind: "NEW_PAYMENT", retailerId: shop.d });
    expect(m.matchKind).toBe("NEW_PAYMENT");
    const p = await tenantDb(T).payment.findUniqueOrThrow({ where: { id: m.matchRef! } });
    expect(p).toMatchObject({ method: "BANK", amount: 7_700, state: "CONFIRMED" });
    expect((await owed(shop.d)) - owed0).toBe(-7_700);

    // Booked matches cannot simply be undone.
    await expect(unmatchLine(T, adminId, upi.id)).rejects.toThrow(/reverse/);
    await expect(ignoreLine(T, adminId, upi.id, true)).rejects.toThrow(/matched/);

    // A wrong amount is refused.
    const csv = ["Date,Narration,Credit,Debit", `${new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)},NEFT odd ${run},1.00,`].join("\n");
    const r = await importStatement(T, adminId, { fileName: "odd.csv", account: "Test current", bytes: Buffer.from(csv) });
    const odd = await tenantDb(T).bankLine.findFirstOrThrow({ where: { statementId: r.statement.id } });
    await expect(matchLine(T, adminId, odd.id, { kind: "UPI_CLEAR", ref: upiId })).rejects.toThrow(/₹/);
    await ignoreLine(T, adminId, odd.id, true, "Interest");
    await expect(matchLine(T, adminId, odd.id, { kind: "CASH_DEPOSIT" })).rejects.toThrow(/Bring the line back/);
    expect((await ignoreLine(T, adminId, odd.id, false)).status).toBe("UNMATCHED");
  });
});

// ───────────────────────────── API keys and webhooks ─────────────────────────────

describe("API keys and the read-only API", () => {
  it("authenticates by hash, checks scope, and stops a revoked key", async () => {
    const db = tenantDb(T);
    const k = makeKey();
    expect(k.key).toMatch(/^setu_[a-z0-9]{8}_/);
    expect(parseScopes(["orders:read", "nope"])).toBeTypeOf("string");
    const row = await db.apiKey.create({ data: { name: `test ${run}`, prefix: k.prefix, hash: k.hash, scopes: ["orders:read"], createdById: adminId } });
    expect(row.hash).not.toContain(k.key.split("_")[2]);
    const req = (key: string) => new Request("http://demo.localhost/api/v1/orders", { headers: { Authorization: `Bearer ${key}` } });
    expect(keyFrom(new Request("http://x", { headers: { "X-Api-Key": k.key } }))).toBe(k.key);
    expect(await checkKey(db, req(k.key), "orders:read", "1.2.3.4")).toMatchObject({ ok: true });
    expect(await checkKey(db, req(k.key), "payments:read", null)).toMatchObject({ ok: false, status: 403 });
    expect(await checkKey(db, req(k.key.slice(0, -2) + "xx"), "orders:read", null)).toMatchObject({ ok: false, status: 401 });
    // Another business's key does not work here.
    expect(await checkKey(tenantDb(T2), req(k.key), "orders:read", null)).toMatchObject({ ok: false, status: 401 });
    await db.apiKey.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    expect(await checkKey(db, req(k.key), "orders:read", null)).toMatchObject({ ok: false, status: 401, error: expect.stringMatching(/revoked/) });
  });

  it("pages with a cursor and filters by updated_since", async () => {
    const first = await withTenantTx(T, (tx) => listResource(tx, "orders", new URLSearchParams("limit=2")));
    if ("error" in first) throw new Error(first.error);
    expect(first.data).toHaveLength(2);
    expect(first.next_cursor).toBeTruthy();
    const second = await withTenantTx(T, (tx) => listResource(tx, "orders", new URLSearchParams(`limit=2&cursor=${first.next_cursor}`)));
    if ("error" in second) throw new Error(second.error);
    const ids = [...first.data, ...second.data].map((o) => (o as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
    const o = first.data[0] as Record<string, unknown>;
    expect(o).toHaveProperty("total_paise");
    expect(o).toHaveProperty("lines");
    const future = await withTenantTx(T, (tx) => listResource(tx, "orders", new URLSearchParams("updated_since=2099-01-01T00:00:00Z")));
    expect("data" in future && future.data).toEqual([]);
    expect(await withTenantTx(T, (tx) => listResource(tx, "orders", new URLSearchParams("updated_since=yesterday")))).toMatchObject({ status: 400 });
    const stock = await withTenantTx(T, (tx) => listResource(tx, "stock", new URLSearchParams("limit=3")));
    expect("data" in stock && (stock.data[0] as Record<string, unknown>)).toHaveProperty("available");
  });
});

describe("outbound webhooks", () => {
  let server: Server;
  let port = 0;
  let mode: "ok" | "fail" = "ok";
  const got: { headers: IncomingMessage["headers"]; body: string }[] = [];

  beforeAll(async () => {
    process.env.ALLOW_PRIVATE_WEBHOOKS = "1";
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        got.push({ headers: req.headers, body });
        res.statusCode = mode === "ok" ? 200 : 500;
        res.end("ok");
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    delete process.env.ALLOW_PRIVATE_WEBHOOKS;
    await new Promise((r) => server.close(r));
  });

  it("refuses private addresses unless allowed", () => {
    delete process.env.ALLOW_PRIVATE_WEBHOOKS;
    expect(checkWebhookUrl("http://example.com/x")).toMatch(/https/);
    expect(checkWebhookUrl("https://10.0.0.5/x")).toMatch(/private/);
    expect(checkWebhookUrl("https://localhost/x")).toMatch(/private/);
    expect(checkWebhookUrl("https://user:pw@example.com/")).toMatch(/password/);
    expect(checkWebhookUrl("https://erp.example.com/hook")).toEqual({ url: "https://erp.example.com/hook" });
    process.env.ALLOW_PRIVATE_WEBHOOKS = "1";
    expect(checkWebhookUrl(`http://127.0.0.1:${port}/`)).toHaveProperty("url");
  });

  it("queues a signed event with the payment and delivers it", async () => {
    const secret = `whsec_${run}`;
    const ep = await tenantDb(T).webhookEndpoint.create({
      data: { url: `http://127.0.0.1:${port}/hook`, events: ["payment.received"], description: `test ${run}`, secret: encryptSecret(secret), createdById: adminId },
    });
    const p = await as(adminId, (ctx) => recordPayment(ctx, { retailerId: shop.b, amount: 1_100, method: "CASH", atOffice: true }));
    const d = await tenantDb(T).webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id } });
    expect(d).toMatchObject({ event: "payment.received", status: "PENDING", eventKey: `payment.received:${p.id}` });

    const r = await flushWebhooks(T);
    expect(r.sent).toBeGreaterThanOrEqual(1);
    const hit = got.find((g) => g.headers["setu-delivery"] === d.id)!;
    expect(hit.headers["setu-event"]).toBe("payment.received");
    const body = JSON.parse(hit.body);
    expect(body).toMatchObject({ id: d.id, event: "payment.received", data: { id: p.id, amount_paise: 1_100, method: "CASH" } });
    const [t, v1] = String(hit.headers["setu-signature"]).split(",");
    const ts = t.slice(2);
    expect(v1.slice(3)).toBe(createHmac("sha256", secret).update(`${ts}.${hit.body}`).digest("hex"));
    expect(sign(secret, hit.body, Number(ts))).toBe(hit.headers["setu-signature"]);
    expect((await tenantDb(T).webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("SENT");
    // An endpoint not subscribed gets nothing.
    expect(Object.keys(WEBHOOK_EVENTS)).toContain("order.placed");
  });

  it("retries with backoff and gives up after the last attempt", async () => {
    mode = "fail";
    const ep = await tenantDb(T).webhookEndpoint.findFirstOrThrow({ where: { description: `test ${run}` } });
    await as(adminId, (ctx) => recordPayment(ctx, { retailerId: shop.b, amount: 1_200, method: "CASH", atOffice: true }));
    const d = await tenantDb(T).webhookDelivery.findFirstOrThrow({ where: { endpointId: ep.id, status: "PENDING" } });
    let now = new Date();
    await flushWebhooks(T, now);
    let row = await tenantDb(T).webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: 1, lastCode: 500 });
    expect(row.nextAttemptAt.getTime() - now.getTime()).toBe(BACKOFF_MINUTES[0] * 60_000);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      now = new Date(row.nextAttemptAt.getTime() + 1000);
      await flushWebhooks(T, now);
      row = await tenantDb(T).webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    }
    expect(row).toMatchObject({ status: "DEAD", attempts: MAX_ATTEMPTS });
    expect((await tenantDb(T).webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } })).failStreak).toBeGreaterThanOrEqual(MAX_ATTEMPTS);
    mode = "ok";
  });
});

describe("tenant isolation", () => {
  it("another business sees none of these rows", async () => {
    const counts = await withTenantTx(T2, async (tx) => ({
      intents: await tx.paymentIntent.count({ where: { retailerId: { in: Object.values(shop) } } }),
      events: await tx.gatewayEvent.count({ where: { eventId: { startsWith: `evt_${run}` } } }),
      lines: await tx.bankLine.count({ where: { narration: { contains: run } } }),
      endpoints: await tx.webhookEndpoint.count({ where: { description: `test ${run}` } }),
      keys: await tx.apiKey.count({ where: { name: `test ${run}` } }),
      settlements: await tx.gatewaySettlement.count({ where: { providerRef: `setl_${run}` } }),
    }));
    expect(counts).toEqual({ intents: 0, events: 0, lines: 0, endpoints: 0, keys: 0, settlements: 0 });
  });
});
