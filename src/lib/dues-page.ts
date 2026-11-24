import { getTenant } from "@/lib/tenant";
import { pageSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { MoneyError } from "@/lib/money-error";
import { istDay } from "@/lib/field-math";
import { filterLine, filterOptions, isDuesView, loadDues, parseDuesFilters, type DuesView } from "@/lib/dues-reports";
import { summaryText } from "@/lib/dues-export";

type SP = Record<string, string | string[] | undefined>;

/** Everything the outstanding / collections pages need, after the same checks as the API. */
export async function duesPage(searchParams: Promise<SP>, fixed?: DuesView) {
  const [tenant, session, raw] = await Promise.all([getTenant(), pageSession(), searchParams]);
  if (!tenant || !session) return { ok: false as const, error: "Please sign in" };
  if (!can(session.role, ["reports.view", "ledger.view"])) return { ok: false as const, error: "You don't have access to money reports" };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  const asked = sp.get("view");
  const view: DuesView = fixed ?? (isDuesView(asked) && asked !== "collections" ? asked : "bills");
  try {
    const [report, options] = await Promise.all([loadDues(tenant.id, view, sp), filterOptions(tenant.id)]);
    const filters = filterLine(parseDuesFilters(sp), options);
    const stamp = report.view === "collections" ? `${report.period.from}-to-${report.period.to}` : report.asOn;
    const file = `${view === "collections" ? "collections" : `outstanding-${view}`}-${stamp}`;
    return { ok: true as const, view, report, options, filters, file, today: istDay(), summary: summaryText(report, tenant.name, filters) };
  } catch (e) {
    if (e instanceof MoneyError) return { ok: false as const, error: e.message };
    throw e;
  }
}
