import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { khataList } from "@/lib/khata";

/**
 * Every retailer's balance, overdue and ageing. Accounts staff see all;
 * a sales agent sees only the retailers on their book.
 * ?filter=overdue|due|advance|all  ?q=search
 */
export async function GET(req: Request) {
  const auth = await guard();
  if (!auth.ok) return auth.res;
  const { session, db, tenant } = auth;

  let salesAgentId: string | undefined;
  if (!can(session.role, "ledger.view")) {
    if (session.role !== "SALES_AGENT") return NextResponse.json({ error: "You don't have access to this" }, { status: 403 });
    const agent = await db.salesAgentProfile.findUnique({ where: { userId: session.userId } });
    if (!agent) return NextResponse.json({ rows: [], totals: null });
    salesAgentId = agent.id;
  }

  const sp = new URL(req.url).searchParams;
  const filter = sp.get("filter") ?? "all";
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  let rows = await khataList(tenant.id, { salesAgentId });

  const totals = rows.reduce(
    (t, r) => {
      t.receivable += Math.max(0, r.receivable);
      t.advance += Math.max(0, -r.receivable);
      t.wallet += r.wallet;
      t.overdue += r.overdue;
      t.d0_7 += r.ageing.d0_7;
      t.d8_15 += r.ageing.d8_15;
      t.d16_30 += r.ageing.d16_30;
      t.d30p += r.ageing.d30p;
      if (r.overdue > 0) t.overdueCount++;
      return t;
    },
    { receivable: 0, advance: 0, wallet: 0, overdue: 0, overdueCount: 0, d0_7: 0, d8_15: 0, d16_30: 0, d30p: 0 }
  );

  if (filter === "overdue") rows = rows.filter((r) => r.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  else if (filter === "due") rows = rows.filter((r) => r.receivable > 0).sort((a, b) => b.receivable - a.receivable);
  else if (filter === "advance") rows = rows.filter((r) => r.receivable < 0 || r.wallet > 0);
  if (q) {
    rows = rows.filter(
      (r) => r.outletName.toLowerCase().includes(q) || r.ownerName.toLowerCase().includes(q) || (r.phone ?? "").includes(q)
    );
  }
  return NextResponse.json({ rows, totals, scope: salesAgentId ? "mine" : "all" });
}
