import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { accountLedger, readPeriod } from "@/lib/books";
import { fileResponse, ledgerCsv, ledgerSheet } from "@/lib/books-export";

/** GET ?account=<code>&from=&to=&format=json|csv|pdf — one account's ledger (default this financial year). */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const code = sp.get("account");
  if (!code) return NextResponse.json({ error: "Pick an account" }, { status: 400 });
  const p = readPeriod(sp);
  if ("error" in p) return NextResponse.json({ error: p.error }, { status: 400 });
  try {
    const ledger = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => accountLedger(ctx, code, p.from, p.to));
    const format = sp.get("format");
    if (format === "csv" || format === "pdf") {
      await audit(auth.db, { actorId: auth.session.userId, action: "report.export", entity: "Report", entityId: `books:ledger:${code}`, after: { format, ...p }, ip: requestIp(req) });
      const slug = ledger.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "account";
      return fileResponse(auth.db, auth.tenant.id, format, `ledger-${slug}-${p.from}-to-${p.to}`, ledgerCsv(ledger), ledgerSheet(ledger));
    }
    return NextResponse.json({ ledger }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
