import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { fyStart, todayIst } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { balanceSheet, profitAndLoss, trialBalance } from "@/lib/final-accounts";
import { bsCsv, bsSheet, plCsv, plMonthsSheet, plSheet, tbCsv, tbSheet } from "@/lib/final-accounts-export";

/**
 * GET ?report=tb|pl|bs [&from=&to=] [&asOn=] [&format=pdf|csv] [&months=1 for the P&L by month PDF]
 *   tb: trial balance for a period (opening, debit, credit, closing); pl: profit and loss with months and last year; bs: balance sheet as at a day.
 */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const today = todayIst();
  const to = sp.get("to") || sp.get("asOn") || today;
  const from = sp.get("from") || fyStart(to);
  const format = sp.get("format");
  const file = format === "pdf" || format === "csv" ? format : null;
  try {
    const run = <T>(fn: Parameters<typeof withMoney<T>>[2]) => withMoney(auth.tenant.id, auth.session.userId, fn);
    const send = (name: string, json: unknown, csv: Parameters<typeof fileResponse>[4], sheet: Parameters<typeof fileResponse>[5]) =>
      file ? fileResponse(auth.db, auth.tenant.id, file, name, csv, sheet) : NextResponse.json(json, { headers: { "cache-control": "no-store" } });
    switch (sp.get("report")) {
      case "pl": {
        const p = await run((ctx) => profitAndLoss(ctx, from, to, { months: true, compare: true }));
        return send(`profit-and-loss-${from}-to-${to}`, p, plCsv(p), sp.get("months") === "1" ? plMonthsSheet(p) : plSheet(p));
      }
      case "bs": {
        const b = await run((ctx) => balanceSheet(ctx, to));
        return send(`balance-sheet-${to}`, b, bsCsv(b), bsSheet(b));
      }
      default: {
        const t = await run((ctx) => trialBalance(ctx, from, to));
        return send(`trial-balance-${from}-to-${to}`, t, tbCsv(t), tbSheet(t));
      }
    }
  } catch (e) {
    return moneyFail(e);
  }
}
