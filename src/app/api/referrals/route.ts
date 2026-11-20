import { engageRead, myShop } from "@/lib/engage-api";
import { referralCodeFor } from "@/lib/referrals";
import { referralSettings } from "@/lib/engage-settings";
import { formatINR } from "@/lib/money";
import { tenantUrl } from "@/lib/notify";

/** GET → my code, the offer, a ready share message, and the shops that joined with my code. */
export async function GET() {
  return engageRead("orders.place", async (ctx, s) => {
    const retailerId = await myShop(ctx.tx, s);
    const t = await ctx.tx.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true, name: true } });
    const offer = referralSettings(t?.settings);
    if (!offer.on) return { on: false as const };
    const code = await referralCodeFor(ctx.tx, retailerId);
    const link = await tenantUrl(ctx.tx, ctx.tenantId, `/login?ref=${code}`);
    const rows = await ctx.tx.referral.findMany({
      where: { referrerId: retailerId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, status: true, referrerReward: true, createdAt: true, rewardedAt: true, expiresAt: true, note: true, referee: { select: { outletName: true } } },
    });
    const earned = rows.filter((r) => r.status === "REWARDED" && !r.note).reduce((a, r) => a + r.referrerReward, 0);
    const reward = formatINR(offer.referrerReward);
    const message =
      `Order from ${t?.name ?? "us"} on VBiz Pro. Sign up with my code ${code}` +
      (offer.refereeReward ? ` and get ${formatINR(offer.refereeReward)} in your wallet` : "") +
      ` after your first order of ${formatINR(offer.minOrder)} or more: ${link}`;
    return {
      on: true as const,
      code,
      link,
      message,
      offer: { reward, refereeReward: offer.refereeReward ? formatINR(offer.refereeReward) : null, minOrder: formatINR(offer.minOrder), validDays: offer.validDays },
      earned,
      items: rows.map((r) => ({ id: r.id, shop: r.referee.outletName, status: r.status, reward: r.referrerReward, createdAt: r.createdAt, rewardedAt: r.rewardedAt, expiresAt: r.expiresAt, note: r.note })),
    };
  });
}
