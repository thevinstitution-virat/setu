import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { chartOfAccounts, ensureBooks, isDay, todayIst } from "@/lib/books";
import { fileResponse, trialCsv, trialSheet } from "@/lib/books-export";

/** GET ?asOn=YYYY-MM-DD&format=json|csv|pdf — chart of accounts with balances (the trial balance). */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const asOn = sp.get("asOn") || todayIst();
  if (!isDay(asOn)) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  try {
    const chart = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
      await ensureBooks(ctx);
      return chartOfAccounts(ctx, asOn);
    });
    const format = sp.get("format");
    if (format === "csv" || format === "pdf") {
      await audit(auth.db, { actorId: auth.session.userId, action: "report.export", entity: "Report", entityId: "books:trial", after: { format, asOn }, ip: requestIp(req) });
      return fileResponse(auth.db, auth.tenant.id, format, `trial-balance-${asOn}`, trialCsv(chart), trialSheet(chart, asOn));
    }
    return NextResponse.json({ chart, asOn }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
