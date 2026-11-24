import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { withMoney } from "@/lib/ledger";
import { dayBook, KIND_LABEL, readPeriod } from "@/lib/books";
import { dayBookCsv, dayBookSheet, fileResponse } from "@/lib/books-export";
import type { EntryKind } from "@/generated/prisma/client";

/** GET ?from=&to=&kind=&format=json|csv|pdf — every entry of a day (default today) or period. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const p = readPeriod(sp, "today");
  if ("error" in p) return NextResponse.json({ error: p.error }, { status: 400 });
  const k = sp.get("kind");
  const kind = k && k in KIND_LABEL ? (k as EntryKind) : null;
  try {
    const book = await withMoney(auth.tenant.id, auth.session.userId, (ctx) => dayBook(ctx, p.from, p.to, kind));
    const format = sp.get("format");
    if (format === "csv" || format === "pdf") {
      await audit(auth.db, { actorId: auth.session.userId, action: "report.export", entity: "Report", entityId: "books:daybook", after: { format, kind, ...p }, ip: requestIp(req) });
      return fileResponse(auth.db, auth.tenant.id, format, `day-book-${p.from}-to-${p.to}`, dayBookCsv(book), dayBookSheet(book));
    }
    return NextResponse.json({ book }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
