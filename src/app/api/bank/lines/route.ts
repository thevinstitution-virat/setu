import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { matchOpen, MATCH_LABEL } from "@/lib/bank";
import type { BankLineStatus, Prisma } from "@/generated/prisma/client";

const STATUSES: BankLineStatus[] = ["UNMATCHED", "SUGGESTED", "MATCHED", "IGNORED"];

/** Bank lines. ?status=open|UNMATCHED|SUGGESTED|MATCHED|IGNORED &statementId= &q= &take= */
export async function GET(req: Request) {
  const auth = await guard("bank.reconcile");
  if (!auth.ok) return auth.res;
  const { db } = auth;
  const sp = new URL(req.url).searchParams;
  const where: Prisma.BankLineWhereInput = {};
  const status = sp.get("status") ?? "open";
  if (status === "open") where.status = { in: ["UNMATCHED", "SUGGESTED"] };
  else if (STATUSES.includes(status as BankLineStatus)) where.status = status as BankLineStatus;
  if (sp.get("statementId")) where.statementId = sp.get("statementId")!;
  const q = sp.get("q")?.trim();
  if (q) where.OR = [{ narration: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }];
  const base = sp.get("statementId") ? { statementId: sp.get("statementId")! } : {};
  const [lines, counts] = await Promise.all([
    db.bankLine.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: Math.min(Number(sp.get("take")) || 200, 500), include: { statement: { select: { account: true } } } }),
    db.bankLine.groupBy({ by: ["status"], where: base, _count: { _all: true }, _sum: { credit: true } }),
  ]);
  return NextResponse.json({
    lines: lines.map(({ statement, ...l }) => ({ ...l, account: statement.account })),
    counts: Object.fromEntries(counts.map((c) => [c.status, { count: c._count._all, credit: c._sum.credit ?? 0 }])),
    labels: MATCH_LABEL,
  });
}

/** Body: { statementId? } — suggest again and match the sure ones (after recording payments). */
export async function POST(req: Request) {
  const auth = await guard("bank.reconcile");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = (await req.json().catch(() => null)) as { statementId?: string } | null;
  try {
    const r = await matchOpen(tenant.id, session.userId, { statementId: typeof body?.statementId === "string" ? body.statementId : undefined });
    if (r.matched) await audit(db, { actorId: session.userId, action: "bank.rematch", entity: "BankLine", after: r, ip: requestIp(req) });
    return NextResponse.json(r);
  } catch (e) {
    return moneyFail(e);
  }
}
