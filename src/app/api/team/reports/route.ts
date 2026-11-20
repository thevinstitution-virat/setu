import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { audit, requestIp } from "@/lib/audit";
import { withMoney } from "@/lib/ledger";
import { moneyFail } from "@/lib/money-api";
import { reportRows, teamScope, toCsv, type ReportKind } from "@/lib/field";

const KINDS = new Set<ReportKind>(["attendance", "visits", "stores", "orders"]);

/** GET ?kind=attendance|visits|stores|orders&from=&to= → CSV download (IST days, at most 92). */
export async function GET(req: Request) {
  const auth = await guard("team.supervise");
  if (!auth.ok) return auth.res;
  const sp = new URL(req.url).searchParams;
  const kind = sp.get("kind") as ReportKind;
  if (!KINDS.has(kind)) return NextResponse.json({ error: "Pick a report" }, { status: 400 });
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  try {
    const rows = await withMoney(auth.tenant.id, auth.session.userId, async (ctx) =>
      reportRows(ctx.tx, await teamScope(ctx.tx, { userId: auth.session.userId, role: auth.session.role }), kind, from, to)
    );
    await audit(auth.db, { actorId: auth.session.userId, action: "report.export", entity: "Report", entityId: kind, after: { from, to, rows: rows.length - 1 }, ip: requestIp(req) });
    return new NextResponse(toCsv(rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${kind}-${from}-to-${to}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return moneyFail(e);
  }
}
