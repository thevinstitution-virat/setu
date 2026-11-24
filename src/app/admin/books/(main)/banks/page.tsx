import { booksPage } from "@/lib/books-page";
import { BANK_KINDS, ensureBooks, ledgerHref } from "@/lib/books";
import { ErrorCard } from "@/components/reports/Kit";
import BanksManager from "@/components/books/BanksManager";

/** Bank accounts with their book balances. */
export default async function BanksPage() {
  const r = await booksPage(async (ctx) => {
    await ensureBooks(ctx);
    const [banks, accounts] = await Promise.all([
      ctx.tx.bankAccount.findMany({ orderBy: [{ isDefault: "desc" }, { active: "desc" }, { name: "asc" }] }),
      ctx.tx.ledgerAccount.findMany({ where: { bankAccountId: { not: null } }, select: { id: true, bankAccountId: true } }),
    ]);
    const sums = accounts.length
      ? await ctx.tx.ledgerLine.groupBy({ by: ["accountId"], where: { accountId: { in: accounts.map((a) => a.id) } }, _sum: { amount: true } })
      : [];
    const byAcc = new Map(sums.map((s) => [s.accountId, Number(s._sum.amount ?? 0)]));
    const bal = new Map<string, number>();
    for (const a of accounts) bal.set(a.bankAccountId!, (bal.get(a.bankAccountId!) ?? 0) + (byAcc.get(a.id) ?? 0));
    return banks.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      bankName: b.bankName,
      last4: b.last4,
      ifsc: b.ifsc,
      branch: b.branch,
      odLimit: b.odLimit,
      isDefault: b.isDefault,
      active: b.active,
      balance: bal.get(b.id) ?? 0,
      ledgerHref: ledgerHref(b.ledgerCode),
    }));
  });
  if (!r.ok) return <ErrorCard message={r.error} />;
  return (
    <div className="space-y-4">
      <BanksManager banks={r.data} kinds={BANK_KINDS} canSetup={r.me.canSetup} />
      <p className="text-xs text-[var(--muted)]">
        A bank account can be closed only when it is not the default and its book balance is ₹0. Bank statements are matched under Money → Bank.
      </p>
    </div>
  );
}
