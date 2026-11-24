import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { createBank, ensureBooks } from "@/lib/books";

/** GET: bank accounts with their book balance. POST: add one (any number). */
export async function GET() {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const banks = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
    await ensureBooks(ctx);
    const list = await ctx.tx.bankAccount.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
    const sums = await ctx.tx.ledgerLine.groupBy({ by: ["accountId"], where: { account: { bankAccountId: { not: null } } }, _sum: { amount: true } });
    const accounts = await ctx.tx.ledgerAccount.findMany({ where: { bankAccountId: { not: null } }, select: { id: true, bankAccountId: true } });
    const bal = new Map<string, number>();
    for (const a of accounts) bal.set(a.bankAccountId!, (bal.get(a.bankAccountId!) ?? 0) + Number(sums.find((s) => s.accountId === a.id)?._sum.amount ?? 0));
    return list.map((b) => ({ ...b, balance: bal.get(b.id) ?? 0 }));
  });
  return NextResponse.json({ banks });
}

export async function POST(req: Request) {
  const auth = await guard("accounts.setup");
  if (!auth.ok) return auth.res;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Missing the account's details" }, { status: 400 });
  try {
    const bank = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => createBank(ctx, body));
    await audit(auth.db, { actorId: auth.session.userId, action: "books.bank.create", entity: "BankAccount", entityId: bank.id, after: bank, ip: requestIp(req) });
    return NextResponse.json({ bank }, { status: 201 });
  } catch (e) {
    return moneyFail(e);
  }
}
