import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { toCsv } from "@/lib/field";
import { filterLine, filterOptions, isDuesView, loadDues, parseDuesFilters } from "@/lib/dues-reports";
import { csvFor, renderSheetPdf, sheetFor, summaryText } from "@/lib/dues-export";

/**
 * GET /api/admin/reports/dues/<bills|parties|agents|collections>
 *   ?asOn=YYYY-MM-DD (outstanding) or ?from=&to= (collections, default today)
 *   &areaId= &salesmanId= &beatId= &weekday=0-6
 *   &format=json (default) | csv | pdf
 * JSON also carries a short summary for sharing on WhatsApp.
 */
export async function GET(req: Request, { params }: { params: Promise<{ view: string }> }) {
  const auth = await guard(["reports.view", "ledger.view"]);
  if (!auth.ok) return auth.res;
  const { view } = await params;
  if (!isDuesView(view)) return NextResponse.json({ error: "No such report" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format");
  try {
    const [report, options] = await Promise.all([loadDues(auth.tenant.id, view, sp), filterOptions(auth.tenant.id)]);
    const f = parseDuesFilters(sp);
    const filters = filterLine(f, options);
    const stamp = report.view === "collections" ? `${report.period.from}-to-${report.period.to}` : report.asOn;
    const file = `${view === "bills" ? "outstanding-bills" : view === "parties" ? "outstanding-parties" : view === "agents" ? "outstanding-salesman" : "collections"}-${stamp}`;

    if (format === "csv" || format === "pdf") {
      await audit(auth.db, { actorId: auth.session.userId, action: "report.export", entity: "Report", entityId: `dues:${view}`, after: { format, stamp, filters }, ip: requestIp(req) });
    }
    if (format === "csv") {
      return new NextResponse(toCsv(csvFor(report)), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}.csv"`, "cache-control": "no-store" },
      });
    }
    if (format === "pdf") {
      const t = await auth.db.tenant.findUniqueOrThrow({ where: { id: auth.tenant.id }, select: { name: true, legalName: true, address: true, gstin: true } });
      const bytes = await renderSheetPdf(sheetFor(report, filters), { name: t.legalName || t.name, address: t.address, gstin: t.gstin });
      return new NextResponse(Buffer.from(bytes), {
        headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${file}.pdf"`, "cache-control": "no-store" },
      });
    }
    return NextResponse.json({ report, options, filters, summary: summaryText(report, auth.tenant.name, filters), file }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
