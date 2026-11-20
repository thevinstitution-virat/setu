import { randomInt } from "node:crypto";
import type { Tx } from "@/lib/db";
import { post, type Ctx } from "@/lib/ledger";
import { MoneyError } from "@/lib/money-error";
import { formatINR } from "@/lib/money";
import { notify } from "@/lib/notify";
import { referralSettings } from "@/lib/engage-settings";

/**
 * Refer and earn. Shop A shares its code; shop B signs up with it. When B's
 * FIRST delivered order (goods after discounts, before GST) reaches the
 * minimum within the valid days, A's wallet gets the reward (and B's, if the
 * business gives one). Rewards are fixed at sign-up, posted in the ledger as
 * Promotions → Wallet, and paid once (the Referral row moves PENDING →
 * REWARDED in the same transaction).
 */

// No 0/O, 1/I/L: codes are read out over the phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode(outletName: string) {
  const letters = outletName.toUpperCase().replace(/[^A-Z]/g, "").replace(/[OIL]/g, "").slice(0, 3).padEnd(3, "X");
  let tail = "";
  for (let i = 0; i < 4; i++) tail += ALPHABET[randomInt(ALPHABET.length)];
  return `${letters}${tail}`;
}

export const normaliseCode = (v: unknown) => (typeof v === "string" ? v.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : "");

/** The shop's code, made the first time it is asked for. */
export async function referralCodeFor(tx: Tx, retailerId: string) {
  const r = await tx.retailerProfile.findUnique({ where: { id: retailerId }, select: { referralCode: true, outletName: true } });
  if (!r) throw new MoneyError("Shop not found", 404);
  if (r.referralCode) return r.referralCode;
  for (let i = 0; i < 8; i++) {
    const code = makeCode(r.outletName);
    if (await tx.retailerProfile.findFirst({ where: { referralCode: code }, select: { id: true } })) continue;
    // Only set it if still empty (two taps at once must not make two codes).
    const res = await tx.retailerProfile.updateMany({ where: { id: retailerId, referralCode: null }, data: { referralCode: code } });
    if (res.count) return code;
    const again = await tx.retailerProfile.findUnique({ where: { id: retailerId }, select: { referralCode: true } });
    if (again?.referralCode) return again.referralCode;
  }
  throw new MoneyError("Could not make a code. Try again.", 500);
}

/** Check a code before sign-up: the shop's name, or why it can't be used. */
export async function lookupCode(tx: Tx, tenantId: string, raw: unknown) {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  if (!referralSettings(t?.settings).on) throw new MoneyError("Refer and earn is not on for this business", 409);
  const code = normaliseCode(raw);
  if (code.length < 5) throw new MoneyError("Enter the code your friend shared");
  const r = await tx.retailerProfile.findFirst({ where: { referralCode: code, user: { active: true } }, select: { id: true, outletName: true } });
  if (!r) throw new MoneyError("This code is not valid", 404);
  return { code, referrerId: r.id, outletName: r.outletName };
}

/** At sign-up: link the new shop to the code's shop, with today's rewards. */
export async function attachReferral(tx: Tx, tenantId: string, refereeId: string, raw: unknown, now = new Date()) {
  const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const s = referralSettings(t?.settings);
  const { code, referrerId } = await lookupCode(tx, tenantId, raw);
  if (referrerId === refereeId) throw new MoneyError("A shop can't use its own code");
  const [a, b] = await Promise.all([
    tx.retailerProfile.findUnique({ where: { id: referrerId }, select: { gstin: true } }),
    tx.retailerProfile.findUnique({ where: { id: refereeId }, select: { gstin: true } }),
  ]);
  if (a?.gstin && b?.gstin && a.gstin === b.gstin) throw new MoneyError("Both shops have the same GSTIN");
  return tx.referral.create({
    data: {
      referrerId,
      refereeId,
      code,
      referrerReward: s.referrerReward,
      refereeReward: s.refereeReward,
      minOrder: s.minOrder,
      expiresAt: new Date(now.getTime() + s.validDays * 24 * 3600_000),
    },
  });
}

/**
 * After a delivery: if this is the referred shop's first delivered order and
 * it qualifies, pay the rewards. Returns what happened (for tests and logs).
 */
export async function qualifyReferral(ctx: Ctx, orderId: string, now = new Date()) {
  const o = await ctx.tx.order.findUnique({ where: { id: orderId }, select: { id: true, retailerId: true, status: true, subtotal: true, orderNumber: true } });
  if (!o || o.status !== "DELIVERED") return "not delivered";
  const ref = await ctx.tx.referral.findUnique({
    where: { refereeId: o.retailerId },
    include: { referrer: { select: { id: true, userId: true, outletName: true, user: { select: { active: true } } } }, referee: { select: { userId: true, outletName: true } } },
  });
  if (!ref || ref.status !== "PENDING") return "no pending referral";
  const earlier = await ctx.tx.order.count({ where: { retailerId: o.retailerId, status: "DELIVERED", id: { not: o.id } } });
  if (earlier > 0) {
    await ctx.tx.referral.update({ where: { id: ref.id }, data: { status: "LAPSED", note: "Not the shop's first delivered order" } });
    return "not first order";
  }
  if (now > ref.expiresAt) {
    await ctx.tx.referral.update({ where: { id: ref.id }, data: { status: "LAPSED", note: "First order came after the offer ended" } });
    return "expired";
  }
  if (o.subtotal < ref.minOrder) {
    await ctx.tx.referral.update({ where: { id: ref.id }, data: { status: "LAPSED", note: `First order ${formatINR(o.subtotal)} was below ${formatINR(ref.minOrder)}` } });
    return "below minimum";
  }
  const t = await ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } });
  const s = referralSettings(t?.settings);
  // The month starts at midnight in India (IST is UTC+5:30), not at 00:00 UTC.
  const IST = 330 * 60_000;
  const ist = new Date(now.getTime() + IST);
  const monthStart = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST);
  const thisMonth = await ctx.tx.referral.count({ where: { referrerId: ref.referrerId, status: "REWARDED", rewardedAt: { gte: monthStart } } });
  const payReferrer = ref.referrer.user.active && thisMonth < s.monthlyCap ? ref.referrerReward : 0;
  // Claim it first: a second delivery event for the same order finds it no longer PENDING.
  const claimed = await ctx.tx.referral.updateMany({
    where: { id: ref.id, status: "PENDING" },
    data: { status: "REWARDED", rewardedAt: now, orderId: o.id, note: payReferrer || !ref.referrerReward ? null : "Monthly limit reached: no reward for the referring shop" },
  });
  if (!claimed.count) return "already rewarded";
  const pay = async (retailerId: string, amount: number, memo: string) => {
    if (amount <= 0) return;
    await post(ctx, {
      kind: "REWARD",
      memo,
      retailerId,
      occurredAt: now,
      lines: [
        { account: { type: "PROMOTIONS" }, amount },
        { account: { type: "WALLET", retailerId }, amount: -amount },
      ],
    });
  };
  await pay(ref.referrerId, payReferrer, `Referral reward: ${ref.referee.outletName} joined with your code`);
  await pay(o.retailerId, ref.refereeReward, `Welcome reward (code ${ref.code})`);
  if (payReferrer) {
    await notify(ctx.tx, ctx.tenantId, {
      event: "referral.reward",
      to: [ref.referrer.userId],
      key: `referral.reward:${ref.id}:referrer`,
      link: "/retailer/refer",
      vars: { amount: formatINR(payReferrer), shop: ref.referee.outletName },
    });
  }
  if (ref.refereeReward) {
    await notify(ctx.tx, ctx.tenantId, {
      event: "referral.reward",
      to: [ref.referee.userId],
      key: `referral.reward:${ref.id}:referee`,
      link: "/retailer/khata",
      vars: { amount: formatINR(ref.refereeReward), shop: ref.referrer.outletName },
    });
  }
  return "rewarded";
}

/** Daily: pending referrals past their end date lapse. */
export async function lapseReferrals(tx: Tx, now = new Date()) {
  const r = await tx.referral.updateMany({ where: { status: "PENDING", expiresAt: { lt: now } }, data: { status: "LAPSED", note: "No qualifying order before the offer ended" } });
  return r.count;
}
