import type { ReferralStatus } from "@/generated/prisma/client";
import { engageRead, qp } from "@/lib/engage-api";

/** GET ?status= → referrals with both shops, newest first, and totals. */
export async function GET(req: Request) {
  const st = qp(req).get("status");
  return engageRead("promotions.manage", async (ctx) => {
    const status = st === "PENDING" || st === "REWARDED" || st === "LAPSED" ? (st as ReferralStatus) : undefined;
    const [items, totals, paid] = await Promise.all([
      ctx.tx.referral.findMany({
        where: status ? { status } : {},
        orderBy: { createdAt: "desc" },
        take: 200,
        include: { referrer: { select: { id: true, outletName: true } }, referee: { select: { id: true, outletName: true } } },
      }),
      ctx.tx.referral.groupBy({ by: ["status"], _count: true }),
      ctx.tx.journalEntry.findMany({ where: { kind: "REWARD" }, select: { lines: { select: { amount: true } } } }),
    ]);
    // Paid out = the positive (Promotions) side of every reward entry.
    const rewardsPaid = paid.reduce((s, e) => s + e.lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0), 0);
    return { items, counts: Object.fromEntries(totals.map((t) => [t.status, t._count])), rewardsPaid };
  });
}
