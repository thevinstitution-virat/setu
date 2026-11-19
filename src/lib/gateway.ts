import type { IntentKind, PaymentIntent, PayPurpose } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { withTenantTx } from "@/lib/db";
import { balanceOf, post, recordPayment, withMoney, type Ctx } from "@/lib/ledger";
import { MoneyError } from "@/lib/money-error";
import { formatINR } from "@/lib/money";
import { decryptSecret, sha256, token } from "@/lib/secrets";
import { gatewayOn, gatewaySettings, type GatewaySettings } from "@/lib/gateway-settings";
import * as rzp from "@/lib/razorpay";
import { tenantUrl } from "@/lib/notify";

/**
 * Online payments through the business's own gateway account (Razorpay).
 *
 * Money flow: a shop pays a link or QR → the gateway tells us (webhook, or
 * the 10-minute sync if a webhook is lost) → we record a CONFIRMED payment,
 * method ONLINE: Dr "Online payments to be settled" / Cr the shop. When the
 * gateway pays our bank (settlement), Dr Bank + Dr Gateway fees / Cr
 * "to be settled". A gateway payment id is recorded once (unique), so
 * repeated webhooks never post twice.
 *
 * Provider "simulator" (demo and tests) makes local links that a button pays.
 */

export const MIN_AMOUNT = 100; // ₹1
export const MAX_AMOUNT = 50_00_000_00; // ₹50 lakh

type Loaded = { g: GatewaySettings; keys: rzp.RzpKeys | null; webhookSecret: string | null };

export async function loadGateway(tx: Tx, tenantId: string): Promise<Loaded> {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const g = gatewaySettings(t?.settings);
  const secret = decryptSecret(g.keySecret);
  return { g, keys: g.provider === "razorpay" && g.keyId && secret ? { keyId: g.keyId, keySecret: secret } : null, webhookSecret: decryptSecret(g.webhookSecret) };
}

/** What the shop owes now (paise, 0 when nothing). */
export async function duesOf(ctx: Ctx, retailerId: string) {
  return Math.max(0, await balanceOf(ctx, { type: "RECEIVABLE", retailerId }));
}

/** Still to collect on one order (its total minus confirmed payments against it). */
export async function orderDue(ctx: Ctx, orderId: string) {
  const o = await ctx.tx.order.findUnique({ where: { id: orderId }, select: { totalAmount: true } });
  if (!o) throw new MoneyError("Order not found", 404);
  const paid = await ctx.tx.payment.aggregate({ where: { orderId, state: "CONFIRMED" }, _sum: { amount: true } });
  return Math.max(0, o.totalAmount - (paid._sum.amount ?? 0));
}

export type IntentInput = {
  kind: IntentKind;
  retailerId: string;
  /** Paise; empty = all dues (or what is left on the order). */
  amount?: number | null;
  purpose?: PayPurpose;
  orderId?: string | null;
  note?: string | null;
};

/**
 * Make a payment link or a single-use UPI QR. The row is saved first, then the
 * gateway is called outside the transaction, then the row gets the gateway's
 * id and URL. A second tap for the same thing returns the open one.
 */
export async function createIntent(tenantId: string, actorId: string | null, input: IntentInput, now = new Date()): Promise<PaymentIntent> {
  const draft = await withMoney(tenantId, actorId, async (ctx) => {
    const { g } = await loadGateway(ctx.tx, tenantId);
    if (!gatewayOn(g)) throw new MoneyError("Online payments are not set up for this business", 409);
    const shop = await ctx.tx.retailerProfile.findUnique({ where: { id: input.retailerId }, select: { id: true } });
    if (!shop) throw new MoneyError("Shop not found", 404);
    const purpose = input.purpose ?? "DUES";
    let orderId: string | null = null;
    if (input.orderId) {
      const o = await ctx.tx.order.findUnique({ where: { id: input.orderId }, select: { retailerId: true, status: true } });
      if (!o || o.retailerId !== shop.id) throw new MoneyError("That order is not this shop's", 404);
      if (o.status === "CANCELLED") throw new MoneyError("This order is cancelled", 409);
      orderId = input.orderId;
    }
    let amount = input.amount ?? null;
    if (amount === null) {
      if (purpose === "WALLET") throw new MoneyError("Enter how much to add to the wallet");
      amount = orderId ? await orderDue(ctx, orderId) : await duesOf(ctx, shop.id);
    }
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT) throw new MoneyError(amount === 0 ? "Nothing to pay right now" : "The amount must be at least ₹1");
    if (amount > MAX_AMOUNT) throw new MoneyError("The amount is too large for one payment");
    const open = await ctx.tx.paymentIntent.findFirst({
      where: { retailerId: shop.id, orderId, kind: input.kind, amount, purpose, status: "CREATED", expiresAt: { gt: new Date(now.getTime() + 60_000) }, providerRef: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    if (open) return { intent: open, reused: true as const };
    const minutes = input.kind === "QR" ? g.qrMinutes : g.linkDays * 24 * 60;
    const intent = await ctx.tx.paymentIntent.create({
      data: {
        kind: input.kind,
        provider: g.provider,
        retailerId: shop.id,
        purpose,
        amount,
        orderId,
        note: input.note?.trim().slice(0, 200) || null,
        expiresAt: new Date(now.getTime() + minutes * 60_000),
        createdById: actorId,
      },
    });
    return { intent, reused: false as const };
  });
  if (draft.reused) return draft.intent;
  const intent = draft.intent;

  // Call the gateway outside any transaction.
  let done: { providerRef: string; shortUrl: string | null; imageUrl: string | null } | { error: string };
  try {
    // Read what the gateway needs, then let the transaction go before calling it.
    const info = await withTenantTx(tenantId, async (tx) => ({
      ...(await loadGateway(tx, tenantId)),
      shop: await tx.retailerProfile.findUniqueOrThrow({ where: { id: intent.retailerId }, select: { outletName: true, user: { select: { phone: true } } } }),
      name: (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } })).name,
      simUrl: await tenantUrl(tx, tenantId, `/pay/sim/${intent.id}`),
      callbackUrl: await tenantUrl(tx, tenantId, "/retailer/khata?paid=1"),
    }));
    const { g, keys, shop } = info;
    const description = `${info.name}: ${intent.orderId ? "order payment" : intent.purpose === "WALLET" ? "wallet top-up" : "dues"} from ${shop.outletName}`;
    const notes = { setu_intent: intent.id, setu_tenant: tenantId };
    if (g.provider === "simulator") {
      done = { providerRef: `sim_${intent.kind === "QR" ? "qr" : "plink"}_${token(8)}`, shortUrl: info.simUrl, imageUrl: null };
    } else if (!keys) {
      throw new MoneyError("Razorpay keys are not set", 409);
    } else if (intent.kind === "LINK") {
      const l = await rzp.createLink(keys, {
        amount: intent.amount,
        referenceId: intent.id,
        description,
        name: shop.outletName,
        phone: /^\d{10}$/.test(shop.user.phone ?? "") ? shop.user.phone : null,
        expireBy: intent.expiresAt,
        acceptPartial: g.acceptPartial && !intent.orderId,
        callbackUrl: info.callbackUrl,
        notes,
      });
      done = { providerRef: l.id, shortUrl: l.short_url, imageUrl: null };
    } else {
      const q = await rzp.createQr(keys, { amount: intent.amount, name: shop.outletName, description, closeBy: intent.expiresAt, notes });
      done = { providerRef: q.id, shortUrl: null, imageUrl: q.image_url };
    }
  } catch (e) {
    done = { error: (e as Error).message?.slice(0, 300) || "The gateway did not answer" };
  }
  return withMoney(tenantId, actorId, async (ctx) => {
    if ("error" in done) {
      await ctx.tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "CANCELLED", error: done.error } });
      throw new MoneyError(`Could not make the payment request: ${done.error}`, 502);
    }
    return ctx.tx.paymentIntent.update({ where: { id: intent.id }, data: done });
  });
}

export type GatewayPayment = { id: string; amount: number; status?: string; method?: string | null; ref?: string | null; at?: Date | null };

/**
 * Record one gateway payment against its request. Safe to call many times
 * for the same payment: the second call finds it and returns "duplicate".
 */
export async function applyGatewayPayment(ctx: Ctx, input: { intentId?: string | null; providerRef?: string | null; payment: GatewayPayment }) {
  const p = input.payment;
  if (p.status && p.status !== "captured") return "not captured" as const;
  if (await ctx.tx.payment.findFirst({ where: { gatewayPaymentId: p.id }, select: { id: true } })) return "duplicate" as const;
  const intent =
    (input.intentId ? await ctx.tx.paymentIntent.findUnique({ where: { id: input.intentId } }) : null) ??
    (input.providerRef ? await ctx.tx.paymentIntent.findFirst({ where: { providerRef: input.providerRef } }) : null);
  if (!intent) return "unknown" as const;
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new MoneyError("Bad amount from the gateway");
  const method = p.method ? p.method.toUpperCase() : null;
  await recordPayment(ctx, {
    retailerId: intent.retailerId,
    amount: p.amount,
    method: "ONLINE",
    purpose: intent.purpose,
    reference: (p.ref ?? p.id).slice(0, 60),
    orderId: intent.orderId,
    collectorId: null,
    atOffice: true,
    note: `Paid online${method ? ` (${method})` : ""}`,
    occurredAt: p.at ?? undefined,
    gateway: { intentId: intent.id, paymentId: p.id },
  });
  const paid = intent.paidAmount + p.amount;
  await ctx.tx.paymentIntent.update({ where: { id: intent.id }, data: { paidAmount: paid, status: paid >= intent.amount ? "PAID" : "PARTIAL" } });
  return "recorded" as const;
}

/** The gateway paid our bank: book the fee, move the rest to Bank. Once per settlement. */
export async function recordSettlement(ctx: Ctx, s: { provider: string; id: string; amount: number; fees: number; tax: number; utr?: string | null; at: Date }) {
  if (await ctx.tx.gatewaySettlement.findFirst({ where: { providerRef: s.id }, select: { id: true } })) return "duplicate" as const;
  if ([s.amount, s.fees, s.tax].some((n) => !Number.isInteger(n) || n < 0) || s.tax > s.fees) throw new MoneyError("Bad settlement amounts");
  const lines = [
    { account: { type: "GATEWAY_CLEARING" as const }, amount: -(s.amount + s.fees) },
    ...(s.amount ? [{ account: { type: "BANK" as const }, amount: s.amount }] : []),
    ...(s.fees ? [{ account: { type: "GATEWAY_FEES" as const }, amount: s.fees }] : []),
  ];
  const entry =
    s.amount + s.fees > 0
      ? await post(ctx, { kind: "GATEWAY_SETTLEMENT", memo: `Gateway settlement ${s.id}${s.utr ? ` (UTR ${s.utr})` : ""}: fee ${formatINR(s.fees)}`, occurredAt: s.at, lines })
      : null;
  await ctx.tx.gatewaySettlement.create({
    data: { provider: s.provider, providerRef: s.id, amount: s.amount, fees: s.fees, tax: s.tax, utr: s.utr ?? null, settledAt: s.at, entryId: entry?.id ?? null },
  });
  return "recorded" as const;
}

// ───────────────────────────── webhooks ─────────────────────────────

type Entity<T> = { entity?: T };
type RzpWebhook = {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: Entity<rzp.RzpPayment>;
    payment_link?: Entity<{ id: string; reference_id?: string; status?: string; notes?: Record<string, string> }>;
    qr_code?: Entity<{ id: string; status?: string; notes?: Record<string, string> }>;
    settlement?: Entity<{ id: string; amount: number; fees: number; tax: number; utr?: string | null; created_at?: number; status?: string }>;
  };
};

const notesOf = (n: unknown): Record<string, string> => (n && typeof n === "object" && !Array.isArray(n) ? (n as Record<string, string>) : {});
const toGatewayPayment = (p: rzp.RzpPayment): GatewayPayment => ({
  id: p.id,
  amount: p.amount,
  status: p.status,
  method: p.method ?? null,
  ref: rzp.paymentRef(p),
  at: p.created_at ? new Date(p.created_at * 1000) : null,
});

/** What one webhook did (stored on the GatewayEvent). */
async function processEvent(ctx: Ctx, body: RzpWebhook): Promise<{ status: "PROCESSED" | "IGNORED"; note?: string }> {
  const pl = body.payload ?? {};
  const pay = pl.payment?.entity;
  switch (body.event) {
    case "payment_link.paid":
    case "payment_link.partially_paid": {
      const link = pl.payment_link?.entity;
      if (!link || !pay) return { status: "IGNORED", note: "no payment in it" };
      const r = await applyGatewayPayment(ctx, { intentId: link.reference_id ?? notesOf(link.notes).setu_intent, providerRef: link.id, payment: toGatewayPayment(pay) });
      return r === "recorded" ? { status: "PROCESSED" } : { status: "IGNORED", note: r };
    }
    case "qr_code.credited": {
      const qr = pl.qr_code?.entity;
      if (!qr || !pay) return { status: "IGNORED", note: "no payment in it" };
      const r = await applyGatewayPayment(ctx, { intentId: notesOf(qr.notes).setu_intent, providerRef: qr.id, payment: toGatewayPayment(pay) });
      return r === "recorded" ? { status: "PROCESSED" } : { status: "IGNORED", note: r };
    }
    case "payment.captured": {
      // Backup for links / QRs whose own event was missed; others are not ours.
      const id = pay ? notesOf(pay.notes).setu_intent : undefined;
      if (!pay || !id) return { status: "IGNORED", note: "not one of our requests" };
      const r = await applyGatewayPayment(ctx, { intentId: id, payment: toGatewayPayment(pay) });
      return r === "recorded" ? { status: "PROCESSED" } : { status: "IGNORED", note: r };
    }
    case "settlement.processed": {
      const s = pl.settlement?.entity;
      if (!s) return { status: "IGNORED", note: "no settlement in it" };
      const r = await recordSettlement(ctx, { provider: "razorpay", id: s.id, amount: s.amount, fees: s.fees ?? 0, tax: s.tax ?? 0, utr: s.utr ?? null, at: s.created_at ? new Date(s.created_at * 1000) : new Date() });
      return r === "recorded" ? { status: "PROCESSED" } : { status: "IGNORED", note: r };
    }
    case "payment_link.expired":
    case "payment_link.cancelled":
    case "qr_code.closed": {
      const ref = pl.payment_link?.entity?.id ?? pl.qr_code?.entity?.id;
      if (!ref) return { status: "IGNORED" };
      const r = await ctx.tx.paymentIntent.updateMany({
        where: { providerRef: ref, status: "CREATED" },
        data: { status: body.event === "payment_link.cancelled" ? "CANCELLED" : "EXPIRED" },
      });
      return r.count ? { status: "PROCESSED" } : { status: "IGNORED", note: "already closed" };
    }
    default:
      return { status: "IGNORED", note: "event not used" };
  }
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === "P2002";

/**
 * POST /api/webhooks/razorpay on the business's own address. Returns the HTTP
 * status to answer: 2xx when handled or ignored (so Razorpay stops), 401 for a
 * bad signature, 500 when processing failed (Razorpay retries).
 */
export async function handleRazorpayWebhook(tenantId: string, raw: string, signature: string | null, eventIdHeader: string | null) {
  const { webhookSecret } = await withTenantTx(tenantId, (tx) => loadGateway(tx, tenantId));
  if (!webhookSecret) return { http: 400, body: { error: "Webhooks are not set up for this business" } };
  if (!rzp.validWebhook(raw, signature, webhookSecret)) return { http: 401, body: { error: "Bad signature" } };
  let body: RzpWebhook;
  try {
    body = JSON.parse(raw) as RzpWebhook;
  } catch {
    return { http: 400, body: { error: "Not JSON" } };
  }
  const eventId = (eventIdHeader || `body:${sha256(raw)}`).slice(0, 100);
  const event = String(body.event ?? "unknown").slice(0, 60);

  const known = await withTenantTx(tenantId, (tx) => tx.gatewayEvent.findFirst({ where: { provider: "razorpay", eventId }, select: { id: true, status: true } }));
  if (known && known.status !== "FAILED") return { http: 200, body: { ok: true, duplicate: true } };

  try {
    const result = await withMoney(tenantId, null, async (ctx) => {
      const r = await processEvent(ctx, body);
      const data = { status: r.status, error: r.note ?? null, event, payload: body as object };
      if (known) await ctx.tx.gatewayEvent.update({ where: { id: known.id }, data });
      else await ctx.tx.gatewayEvent.create({ data: { provider: "razorpay", eventId, ...data } });
      return r;
    });
    return { http: 200, body: { ok: true, ...result } };
  } catch (e) {
    // Another delivery of the same event got there first.
    if (isUnique(e)) return { http: 200, body: { ok: true, duplicate: true } };
    const error = ((e as Error).message ?? String(e)).slice(0, 300);
    await withTenantTx(tenantId, async (tx) => {
      if (known) await tx.gatewayEvent.update({ where: { id: known.id }, data: { status: "FAILED", error } });
      else await tx.gatewayEvent.create({ data: { provider: "razorpay", eventId, event, payload: body as object, status: "FAILED", error } }).catch(() => null);
    });
    return { http: 500, body: { error: "Could not process" } };
  }
}

// ───────────────────────────── sync, cancel, simulator ─────────────────────────────

/** Ask the gateway what happened to one request (button, and the 10-minute sweep). */
export async function syncIntent(tenantId: string, intentId: string, now = new Date()) {
  const { intent, keys } = await withTenantTx(tenantId, async (tx) => ({
    intent: await tx.paymentIntent.findUnique({ where: { id: intentId } }),
    keys: (await loadGateway(tx, tenantId)).keys,
  }));
  if (!intent) throw new MoneyError("Payment request not found", 404);
  let found: GatewayPayment[] = [];
  let closed: "EXPIRED" | "CANCELLED" | null = null;
  if (intent.provider === "razorpay" && keys && intent.providerRef) {
    if (intent.kind === "LINK") {
      const l = await rzp.fetchLink(keys, intent.providerRef);
      for (const p of l.payments ?? []) {
        if (p.status !== "captured") continue;
        const full = await rzp.fetchPayment(keys, p.payment_id).catch(() => null);
        found.push(full ? toGatewayPayment(full) : { id: p.payment_id, amount: p.amount, status: p.status, method: p.method ?? null, ref: p.payment_id });
      }
      if (l.status === "expired") closed = "EXPIRED";
      if (l.status === "cancelled") closed = "CANCELLED";
    } else {
      found = (await rzp.qrPayments(keys, intent.providerRef)).items.map(toGatewayPayment);
    }
  }
  return withMoney(tenantId, null, async (ctx) => {
    let recorded = 0;
    for (const p of found) if ((await applyGatewayPayment(ctx, { intentId: intent.id, payment: p })) === "recorded") recorded++;
    const fresh = await ctx.tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    if (fresh.status === "CREATED" && (closed || fresh.expiresAt < now)) {
      return { recorded, intent: await ctx.tx.paymentIntent.update({ where: { id: intent.id }, data: { status: closed ?? "EXPIRED" } }) };
    }
    return { recorded, intent: fresh };
  });
}

/** Every 10 minutes: open requests from the last 3 days, in case a webhook was lost. */
export async function syncOpen(tenantId: string, now = new Date()) {
  const open = await withTenantTx(tenantId, (tx) =>
    tx.paymentIntent.findMany({
      where: { status: { in: ["CREATED", "PARTIAL"] }, createdAt: { gt: new Date(now.getTime() - 3 * 24 * 3600_000) } },
      select: { id: true },
      take: 50,
      orderBy: { createdAt: "desc" },
    })
  );
  let recorded = 0;
  for (const i of open) {
    try {
      recorded += (await syncIntent(tenantId, i.id, now)).recorded;
    } catch (e) {
      console.error("[gateway] sync failed", i.id, (e as Error).message);
    }
  }
  // Older open requests just expire.
  await withTenantTx(tenantId, (tx) => tx.paymentIntent.updateMany({ where: { status: "CREATED", expiresAt: { lt: now } }, data: { status: "EXPIRED" } }));
  return recorded;
}

export async function cancelIntent(tenantId: string, actorId: string | null, intentId: string) {
  const { intent, keys } = await withTenantTx(tenantId, async (tx) => ({
    intent: await tx.paymentIntent.findUnique({ where: { id: intentId } }),
    keys: (await loadGateway(tx, tenantId)).keys,
  }));
  if (!intent) throw new MoneyError("Payment request not found", 404);
  if (intent.status !== "CREATED") throw new MoneyError("Only an unpaid request can be cancelled", 409);
  if (intent.provider === "razorpay" && keys && intent.providerRef) {
    // Already closed at the gateway is fine; anything else stops here.
    await (intent.kind === "LINK" ? rzp.cancelLink(keys, intent.providerRef) : rzp.closeQr(keys, intent.providerRef)).catch((e: rzp.RazorpayError) => {
      if (e.status !== 400) throw new MoneyError(`Razorpay: ${e.message}`, 502);
    });
  }
  return withMoney(tenantId, actorId, async (ctx) => {
    const r = await ctx.tx.paymentIntent.updateMany({ where: { id: intentId, status: "CREATED" }, data: { status: "CANCELLED" } });
    if (!r.count) throw new MoneyError("It was paid in the meantime", 409);
    return ctx.tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
  });
}

/** Demo / tests: pay a simulator request (all that is left, or a part). */
export async function simulatePay(tenantId: string, intentId: string, amount?: number | null) {
  return withMoney(tenantId, null, async (ctx) => {
    const intent = await ctx.tx.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.provider !== "simulator") throw new MoneyError("Payment request not found", 404);
    if (intent.status !== "CREATED" && intent.status !== "PARTIAL") throw new MoneyError("This request is closed", 409);
    if (intent.expiresAt < new Date()) throw new MoneyError("This request has expired", 409);
    const left = intent.amount - intent.paidAmount;
    const pay = amount ?? left;
    if (!Number.isInteger(pay) || pay <= 0 || pay > left) throw new MoneyError(`Pay up to ${formatINR(left)}`);
    const rrn = String(Math.floor(1e11 + Math.random() * 9e11));
    return applyGatewayPayment(ctx, { intentId, payment: { id: `sim_pay_${token(9)}`, amount: pay, status: "captured", method: "upi", ref: rrn, at: new Date() } });
  });
}
