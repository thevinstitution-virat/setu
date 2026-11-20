import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { withTenantTx } from "@/lib/db";

/**
 * Day book for one IST day (?date=YYYY-MM-DD, default today): how total
 * outstanding moved and why. Phase 1 exit check — every rupee reconciles:
 *   opening outstanding + sales − collections ± adjustments = closing outstanding.
 */
export async function GET(req: Request) {
  const auth = await guard("ledger.view");
  if (!auth.ok) return auth.res;
  const raw = new URL(req.url).searchParams.get("date");
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const from = new Date(`${date}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 86_400_000);
  if (Number.isNaN(from.getTime())) return NextResponse.json({ error: "Bad date" }, { status: 400 });

  const data = await withTenantTx(auth.tenant.id, async (tx) => {
    const [opening, closing, byKind, collections] = await Promise.all([
      tx.$queryRaw<{ total: bigint }[]>`
        SELECT COALESCE(SUM(l.amount), 0)::bigint AS total
        FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE a.type = 'RECEIVABLE' AND e."occurredAt" < ${from}`,
      tx.$queryRaw<{ total: bigint }[]>`
        SELECT COALESCE(SUM(l.amount), 0)::bigint AS total
        FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE a.type = 'RECEIVABLE' AND e."occurredAt" < ${to}`,
      tx.$queryRaw<{ kind: string; total: bigint; count: bigint }[]>`
        SELECT e.kind::text AS kind, SUM(l.amount)::bigint AS total, COUNT(DISTINCT e.id)::bigint AS count
        FROM "LedgerLine" l JOIN "LedgerAccount" a ON a.id = l."accountId" JOIN "JournalEntry" e ON e.id = l."entryId"
        WHERE a.type = 'RECEIVABLE' AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to}
        GROUP BY e.kind ORDER BY e.kind`,
      tx.payment.groupBy({
        by: ["method", "purpose"],
        where: { state: "CONFIRMED", collectedAt: { gte: from, lt: to } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    const movements = byKind.map((k) => ({ kind: k.kind, amount: Number(k.total), entries: Number(k.count) }));
    const o = Number(opening[0]?.total ?? 0);
    const c = Number(closing[0]?.total ?? 0);
    const moved = movements.reduce((t, m) => t + m.amount, 0);
    return {
      date,
      openingOutstanding: o,
      closingOutstanding: c,
      /** SALE, PAYMENT, CHEQUE_BOUNCE, … : effect on outstanding (+ raises, − lowers). */
      movements,
      collections: collections.map((x) => ({ method: x.method, purpose: x.purpose, amount: Number(x._sum.amount ?? 0), count: x._count })),
      reconciles: o + moved === c,
    };
  });
  return NextResponse.json(data);
}
