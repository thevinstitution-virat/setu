import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { readPeriod } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { cashBook } from "@/lib/vouchers";
import { cashBookCsv, cashBookSheet } from "@/lib/vouchers-export";

/** GET ?account=<cash or bank code>&from=&to=[&format=pdf|csv]: the cash book or bank book. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const period = readPeriod(sp, "today");
  if ("error" in period) return NextResponse.json({ error: period.error }, { status: 400 });
  try {
    const book = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => cashBook(ctx, sp.get("account") || "OFFICE_CASH", period.from, period.to));
    const format = sp.get("format");
    if (format === "pdf" || format === "csv") {
      const file = `${book.kind === "bank" ? "bank" : "cash"}-book-${period.from}-${period.to}`;
      return fileResponse(auth.db, auth.tenant.id, format, file, cashBookCsv(book), cashBookSheet(book));
    }
    return NextResponse.json(book, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
