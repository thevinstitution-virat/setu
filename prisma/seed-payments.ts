/**
 * Phase 8 demo: online payments through the practice gateway (no real money;
 * a button on the link's page pays it), one link part paid and one open, a
 * shop's reported UPI payment waiting, and a bank statement whose lines show
 * each state: matched on import, suggested (cash deposit, a shop's IMPS),
 * not matched, and money out set aside. No API keys or webhook addresses are
 * seeded (a key is shown only once, when made). Names and numbers are made up.
 */
import type { Db } from "./seed";
import { recordPayment, withMoney } from "../src/lib/ledger";
import { GATEWAY_DEFAULTS } from "../src/lib/gateway-settings";
import { createIntent, simulatePay } from "../src/lib/gateway";
import { importStatement } from "../src/lib/bank";
import { PrismaClient } from "../src/generated/prisma/client";

type Ids = { tenantId: string; adminId: string; shops: { agarwal: string; patel: string; sai: string }; saiUserId: string };

export async function seedPayments(db: Db, prisma: PrismaClient, ids: Ids) {
  const { tenantId: T, adminId, shops } = ids;
  const t = await prisma.tenant.findUniqueOrThrow({ where: { id: T }, select: { settings: true } });
  await prisma.tenant.update({
    where: { id: T },
    data: { settings: { ...(t.settings as object), gateway: { ...GATEWAY_DEFAULTS, provider: "simulator", acceptPartial: true, retailerPay: true } } as object },
  });

  // Agarwal: a ₹1,500 link, ₹500 paid so far. Sai Super Mart: a ₹800 link not yet paid.
  const a = await createIntent(T, adminId, { kind: "LINK", retailerId: shops.agarwal, amount: 150_000, note: "Dues for last week" });
  await simulatePay(T, a.id, 50_000);
  await createIntent(T, adminId, { kind: "LINK", retailerId: shops.sai, amount: 80_000 });

  // Sai reported a UPI payment the office has not confirmed yet; the statement confirms it.
  const rrn = "633418024511";
  await withMoney(T, ids.saiUserId, (ctx) => recordPayment(ctx, { retailerId: shops.sai, amount: 42_000, method: "UPI", reference: rrn, needsVerification: true, note: "Paid by UPI" }));

  const day = (n: number) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10).split("-").reverse().join("/");
  const csv = [
    "Statement of account,,,,,",
    "Account,Current account XXXX4321,,,,",
    ",,,,,",
    "Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    `${day(3)},NEFT CR-KKBK0000123-UNKNOWN PARTY,KKBKN52026111500042,,"6,250.00","1,06,250.00"`,
    `${day(2)},UPI/${rrn}/SAI SUPER MART/okaxis,${rrn},,420.00,"1,06,670.00"`,
    `${day(2)},BY CASH DEPOSIT - BRANCH,,,"2,000.00","1,08,670.00"`,
    `${day(1)},IMPS/P2A/633512340001/9123456780/Payment,633512340001,,"1,250.00","1,09,920.00"`,
    `${day(1)},CHARGES FOR SMS ALERTS,,17.70,,"1,09,902.30"`,
  ].join("\n");
  await importStatement(T, adminId, { fileName: "demo-statement.csv", account: "Current account", bytes: Buffer.from(csv) });
  void db;
}
