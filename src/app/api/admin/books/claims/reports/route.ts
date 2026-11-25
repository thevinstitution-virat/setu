import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { isDay, readPeriod, todayIst } from "@/lib/books";
import { fileResponse } from "@/lib/books-export";
import { claimsByType, pendingClaims, settlementsIn } from "@/lib/claims";
import { byTypeCsv, byTypeSheet, pendingCsv, pendingSheet, settledCsv, settledSheet } from "@/lib/claims-export";

const REPORTS = ["pending", "settled", "types"] as const;
type Report = (typeof REPORTS)[number];

/** GET ?report=pending (&asOn=) | settled | types (&from=&to=) &supplier= &format=json|csv|pdf. */
export async function GET(req: Request) {
  const auth = await guard("accounts.view");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const report: Report = REPORTS.find((r) => r === sp.get("report")) ?? "pending";
  const asOn = sp.get("asOn") || todayIst();
  if (!isDay(asOn)) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  const supplierId = sp.get("supplier") || null;
  const format = sp.get("format");
  const out = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) => {
    const who = supplierId ? ((await ctx.tx.supplier.findUnique({ where: { id: supplierId }, select: { name: true } }))?.name ?? "") : "";
    if (report === "pending") {
      const r = await pendingClaims(ctx, asOn, { supplierId });
      return { json: r as unknown, file: `claims-pending-${asOn}`, csv: pendingCsv(r), sheet: pendingSheet(r, who) };
    }
    const p = readPeriod(sp);
    if ("error" in p) return { error: p.error };
    if (report === "settled") {
      const r = await settlementsIn(ctx, p.from, p.to, { supplierId });
      return { json: r as unknown, file: `claims-settled-${p.from}-to-${p.to}`, csv: settledCsv(r), sheet: settledSheet(r, who) };
    }
    const r = await claimsByType(ctx, p.from, p.to, { supplierId });
    return { json: r as unknown, file: `claims-by-type-${p.from}-to-${p.to}`, csv: byTypeCsv(r), sheet: byTypeSheet(r, who) };
  });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: 400 });
  if (format === "csv" || format === "pdf") {
    await audit(auth.db, {
      actorId: auth.session.userId,
      action: "report.export",
      entity: "Report",
      entityId: `books:claims:${report}`,
      after: { format, asOn, supplierId },
      ip: requestIp(req),
    });
    return fileResponse(auth.db, auth.tenant.id, format, out.file, out.csv, out.sheet);
  }
  return NextResponse.json(out.json, { headers: { "cache-control": "no-store" } });
}
