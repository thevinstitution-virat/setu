import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { moneyFail } from "@/lib/money-api";
import { parsePeriod, previousPeriod } from "@/lib/analytics";
import { csvRows, isReportKind } from "@/lib/analytics-csv";
import { loadReport } from "@/lib/reports";
import { toCsv } from "@/lib/field";

/**
 * GET /api/admin/reports/<dashboard|sales|retailers|team|stock|delivery|schemes|routes|returns>
 * ?preset=today|yesterday|7d|30d|mtd|last_month|90d|fy or ?from=&to= (IST days, at most a year).
 * retailers also takes ?areaId= / ?salesAgentId=. ?format=csv downloads it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ report: string }> }) {
  const auth = await guard("reports.view");
  if (!auth.ok) return auth.res;
  const { report } = await params;
  if (!isReportKind(report)) return NextResponse.json({ error: "No such report" }, { status: 404 });
  const sp = new URL(req.url).searchParams;
  try {
    const { period, preset } = parsePeriod(sp);
    const filters = { areaId: sp.get("areaId") || undefined, salesAgentId: sp.get("salesAgentId") || undefined };
    const data = await loadReport(auth.tenant.id, report, period, filters);
    if (sp.get("format") === "csv") {
      const rows = csvRows(report, data as never);
      await audit(auth.db, { actorId: auth.session.userId, action: "report.export", entity: "Report", entityId: report, after: { from: period.from, to: period.to, rows: rows.length }, ip: requestIp(req) });
      return new NextResponse(toCsv(rows), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${report}-${period.from}-to-${period.to}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    const prev = previousPeriod(period);
    return NextResponse.json({ period: { from: period.from, to: period.to, days: period.days, preset }, previous: { from: prev.from, to: prev.to }, data }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return moneyFail(e);
  }
}
