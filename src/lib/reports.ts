import { withTenantTx } from "@/lib/db";
import { getTenant } from "@/lib/tenant";
import { pageSession } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { MoneyError } from "@/lib/money-error";
import { parsePeriod, type Preset } from "@/lib/report-periods";
import {
  agentPerformance,
  deliveryPerformance,
  ownerDashboard,
  productMix,
  retailerAnalytics,
  retailerDetail,
  returnsAndDamage,
  routeProfitability,
  salesByDay,
  schemeRoi,
  stockValue,
  type Period,
} from "@/lib/analytics";
import { reportSettings } from "@/lib/report-settings";
import type { ReportData, ReportKind } from "@/lib/analytics-csv";

/** Long reports (a year of invoices) get more time than a normal request. */
const TIMEOUT = 45_000;

export type ReportFilters = { areaId?: string; salesAgentId?: string };

/** One report for one business over a period (read-only, in its own transaction). */
export async function loadReport<K extends ReportKind>(tenantId: string, kind: K, p: Period, filters: ReportFilters = {}, now = new Date()): Promise<ReportData[K]> {
  return withTenantTx(
    tenantId,
    async (tx): Promise<ReportData[ReportKind]> => {
      switch (kind) {
        case "dashboard":
          return ownerDashboard(tx, p, now);
        case "sales": {
          const [days, mix] = await Promise.all([salesByDay(tx, p), productMix(tx, p)]);
          return { days, mix };
        }
        case "retailers":
          return retailerAnalytics(tx, p, filters);
        case "team":
          return agentPerformance(tx, p);
        case "stock":
          return stockValue(tx, now);
        case "delivery":
          return deliveryPerformance(tx, p);
        case "schemes":
          return schemeRoi(tx, p);
        case "routes": {
          const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
          const { tripCost, dropCost } = reportSettings(t.settings);
          return routeProfitability(tx, p, { tripCost, dropCost });
        }
        case "returns":
          return returnsAndDamage(tx, p);
      }
    },
    { timeout: TIMEOUT }
  ) as Promise<ReportData[K]>;
}

export async function loadShop(tenantId: string, retailerId: string, p: Period, now = new Date()) {
  return withTenantTx(tenantId, (tx) => retailerDetail(tx, retailerId, p, now), { timeout: TIMEOUT });
}

type SP = Record<string, string | string[] | undefined>;

/** For report pages: who may see them, and the period from the URL. */
export async function reportContext(searchParams: Promise<SP>): Promise<{ ok: true; tenantId: string; period: Period; preset: Preset | null; sp: URLSearchParams } | { ok: false; error: string }> {
  const [tenant, session, raw] = await Promise.all([getTenant(), pageSession(), searchParams]);
  if (!tenant || !session) return { ok: false, error: "Please sign in" };
  if (!can(session.role, "reports.view")) return { ok: false, error: "You don't have access to reports" };
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") sp.set(k, v);
  try {
    const { period, preset } = parsePeriod(sp);
    return { ok: true, tenantId: tenant.id, period, preset, sp };
  } catch (e) {
    if (e instanceof MoneyError) return { ok: false, error: e.message };
    throw e;
  }
}
