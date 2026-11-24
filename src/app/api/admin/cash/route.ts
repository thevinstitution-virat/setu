import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withTenantTx } from "@/lib/db";
import { withMoney, writeOffShortage } from "@/lib/ledger";
import { handoverWithExpenses, type ExpenseLine } from "@/lib/vouchers";
import { moneyFail } from "@/lib/money-api";

/** Cash held by each staff member, plus recent handovers. */
export async function GET() {
  const auth = await guard("cash.handover");
  if (!auth.ok) return auth.res;
  const { db, tenant } = auth;

  const held = await withTenantTx(tenant.id, (tx) =>
    tx.$queryRaw<{ userId: string; total: bigint }[]>`
      SELECT a."userId", COALESCE(SUM(l.amount), 0)::bigint AS total
      FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id
      WHERE a.type = 'STAFF_CASH' GROUP BY a."userId"`
  );
  const office = await withTenantTx(tenant.id, (tx) =>
    tx.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(l.amount), 0)::bigint AS total
      FROM "LedgerAccount" a JOIN "LedgerLine" l ON l."accountId" = a.id
      WHERE a.type = 'OFFICE_CASH'`
  );
  const staff = await db.user.findMany({
    where: { role: { in: ["DELIVERY_AGENT", "SALES_AGENT"] } },
    select: { id: true, name: true, role: true, phone: true, active: true },
    orderBy: { name: "asc" },
  });
  const since = new Date(Date.now() - 86_400_000);
  const today = await db.payment.groupBy({
    by: ["collectedById"],
    where: { method: "CASH", state: "CONFIRMED", collectedAt: { gte: since } },
    _sum: { amount: true },
  });
  const lastHandover = await db.cashHandover.groupBy({ by: ["staffUserId"], _max: { createdAt: true } });
  const heldBy = new Map(held.map((h) => [h.userId, Number(h.total)]));
  const todayBy = new Map(today.map((t) => [t.collectedById, Number(t._sum.amount ?? 0)]));
  const lastBy = new Map(lastHandover.map((h) => [h.staffUserId, h._max.createdAt]));

  const rows = staff
    .map((s) => ({
      ...s,
      cashInHand: heldBy.get(s.id) ?? 0,
      collected24h: todayBy.get(s.id) ?? 0,
      lastHandoverAt: lastBy.get(s.id) ?? null,
    }))
    .filter((s) => s.active || s.cashInHand !== 0);
  const handovers = await db.cashHandover.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { staff: { select: { name: true } } },
  });
  return NextResponse.json({
    rows,
    handovers,
    officeCash: Number(office[0]?.total ?? 0),
    totalWithStaff: rows.reduce((t, r) => t + r.cashInHand, 0),
  });
}

/**
 *   { action: "handover", staffUserId, counted (paise), note?, expenses?: [{ headId, amount (paise), note? }], photos?: [key], reference? }
 *     Expenses paid from the cash (fuel, toll, loading) go in first as one payment voucher.
 *   { action: "writeoff", staffUserId, amount (paise), note }
 */
export async function POST(req: Request) {
  const auth = await guard("cash.handover");
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;
  const body = await req.json().catch(() => null);
  const staffUserId = typeof body?.staffUserId === "string" ? body.staffUserId : "";
  const staff = await db.user.findUnique({ where: { id: staffUserId }, select: { id: true } });
  if (!staff) return NextResponse.json({ error: "Staff member not found" }, { status: 404 });
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 300) : "";

  let result: unknown;
  try {
    if (body?.action === "handover") {
      const expenses: ExpenseLine[] = Array.isArray(body.expenses) ? body.expenses.slice(0, 20).map((e: Record<string, unknown>) => ({ headId: String(e?.headId ?? ""), amount: Number(e?.amount), note: typeof e?.note === "string" ? e.note : null })) : [];
      const photos: string[] = Array.isArray(body.photos) ? body.photos.map(String) : [];
      result = await withMoney(tenant.id, session.userId, (ctx) =>
        handoverWithExpenses(ctx, { staffUserId, counted: Number(body.counted), note: note || undefined, expenses, photos, reference: typeof body.reference === "string" ? body.reference : null })
      );
    } else if (body?.action === "writeoff") {
      if (note.length < 3) return NextResponse.json({ error: "Write why this is written off" }, { status: 400 });
      result = await withMoney(tenant.id, session.userId, (ctx) => writeOffShortage(ctx, staffUserId, Number(body.amount), note));
    } else {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return moneyFail(e);
  }
  await audit(db, { actorId: session.userId, action: `cash.${body.action}`, entity: "User", entityId: staffUserId, after: { counted: body.counted, amount: body.amount, note, expenses: (result as { voucher?: { number: string; amount: number } | null })?.voucher ?? null }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, result });
}
