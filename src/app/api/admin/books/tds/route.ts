import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { fyStart, todayIst } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { fyOf, quarterOf, return26q, tdsReceived, tdsRegister, tdsYear } from "@/lib/tds";
import { q26Csv, q26Sheet, receivedCsv, receivedSheet, registerCsv, registerSheet, yearCsv, yearSheet } from "@/lib/tds-export";

/**
 * GET ?view=register&from&to: TDS kept back.
 *     ?view=year&fy=2026: paid vs due by month and section, and the challans.
 *     ?view=26q&fy&q: the quarterly return working.
 *     ?view=received&from&to: TDS customers kept back from us.
 *   &format=pdf|csv for a file.
 */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const today = todayIst();
  const f = sp.get("format");
  const format = f === "pdf" || f === "csv" ? f : null;
  const to = sp.get("to") || today;
  const from = sp.get("from") || fyStart(to);
  const fy = Number(sp.get("fy")) || fyOf(today);
  try {
    const run = <T>(fn: Parameters<typeof withMoney<T>>[2]) => withMoney(auth.tenant.id, auth.session.userId, fn);
    const json = (x: unknown) => NextResponse.json(x, { headers: { "cache-control": "no-store" } });
    switch (sp.get("view")) {
      case "year": {
        const y = await run((ctx) => tdsYear(ctx, fy));
        return format ? fileResponse(auth.db, auth.tenant.id, format, `tds-paid-and-due-${y.label}`, yearCsv(y), yearSheet(y)) : json(y);
      }
      case "26q": {
        const q = Number(sp.get("q")) || quarterOf(today);
        const r = await run((ctx) => return26q(ctx, fy, q));
        return format ? fileResponse(auth.db, auth.tenant.id, format, `tds-26q-${r.fy}-q${r.q}`, q26Csv(r), q26Sheet(r)) : json(r);
      }
      case "received": {
        const r = await run((ctx) => tdsReceived(ctx, from, to));
        return format ? fileResponse(auth.db, auth.tenant.id, format, `tds-by-customers-${r.from}-to-${r.to}`, receivedCsv(r), receivedSheet(r)) : json(r);
      }
      default: {
        const r = await run((ctx) => tdsRegister(ctx, from, to));
        return format ? fileResponse(auth.db, auth.tenant.id, format, `tds-register-${r.from}-to-${r.to}`, registerCsv(r), registerSheet(r)) : json(r);
      }
    }
  } catch (e) {
    return moneyFail(e);
  }
}
