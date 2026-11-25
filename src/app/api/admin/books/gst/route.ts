import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { fyStart, todayIst } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { periodOf, shiftPeriod } from "@/lib/gst-math";
import { gstMonth, itcRegister, match2b } from "@/lib/gst-returns";
import { itcCsv, itcSheet, matchCsv, monthCsv, monthSheet } from "@/lib/gst-returns-export";

/**
 * GET ?view=3b&period=YYYY-MM: a month's GSTR-3B working and set-off (default last month).
 *     ?view=itc&from&to: the input credit register.
 *     ?view=2b&period: the GSTR-2B match.
 *   &format=pdf|csv for a file (2B: csv only).
 */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const today = todayIst();
  const period = sp.get("period") || shiftPeriod(periodOf(today), -1);
  const f = sp.get("format");
  const format = f === "pdf" || f === "csv" ? f : null;
  try {
    const run = <T>(fn: Parameters<typeof withMoney<T>>[2]) => withMoney(auth.tenant.id, auth.session.userId, fn);
    switch (sp.get("view")) {
      case "itc": {
        const to = sp.get("to") || today;
        const r = await run((ctx) => itcRegister(ctx, sp.get("from") || fyStart(to), to));
        return format ? fileResponse(auth.db, auth.tenant.id, format, `input-credit-${r.from}-to-${r.to}`, itcCsv(r), itcSheet(r)) : NextResponse.json(r, { headers: { "cache-control": "no-store" } });
      }
      case "2b": {
        const m = await run((ctx) => match2b(ctx, period));
        if (format) return fileResponse(auth.db, auth.tenant.id, "csv", `gstr-2b-match-${period}`, matchCsv(m), { title: "", subtitle: "", landscape: false, cols: [], rows: [] });
        return NextResponse.json(m, { headers: { "cache-control": "no-store" } });
      }
      default: {
        const m = await run((ctx) => gstMonth(ctx, period));
        return format ? fileResponse(auth.db, auth.tenant.id, format, `gstr-3b-working-${period}`, monthCsv(m), monthSheet(m)) : NextResponse.json(m, { headers: { "cache-control": "no-store" } });
      }
    }
  } catch (e) {
    return moneyFail(e);
  }
}
