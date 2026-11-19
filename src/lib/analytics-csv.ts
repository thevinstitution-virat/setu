/**
 * CSV rows for each Phase 10 report (Excel-friendly; amounts in rupees with
 * two decimals). Uses toCsv from lib/field for quoting and formula guarding.
 */
import type { agentPerformance, ownerDashboard, productMix, retailerAnalytics, returnsAndDamage, routeProfitability, schemeRoi, stockValue, deliveryPerformance } from "@/lib/analytics";
import { CHURN_LABEL } from "@/lib/analytics";

type Cell = string | number | null;
const rs = (p: number | null | undefined) => (p == null ? "" : (p / 100).toFixed(2));
const pct = (v: number | null | undefined) => (v == null ? "" : `${v}%`);

export type ReportData = Data;
type Data = {
  dashboard: Awaited<ReturnType<typeof ownerDashboard>>;
  sales: { days: { day: string; net: number }[]; mix: Awaited<ReturnType<typeof productMix>> };
  retailers: Awaited<ReturnType<typeof retailerAnalytics>>;
  team: Awaited<ReturnType<typeof agentPerformance>>;
  stock: Awaited<ReturnType<typeof stockValue>>;
  delivery: Awaited<ReturnType<typeof deliveryPerformance>>;
  schemes: Awaited<ReturnType<typeof schemeRoi>>;
  routes: Awaited<ReturnType<typeof routeProfitability>>;
  returns: Awaited<ReturnType<typeof returnsAndDamage>>;
};

export function csvRows<K extends keyof Data>(kind: K, d: Data[K]): Cell[][] {
  switch (kind) {
    case "dashboard": {
      const x = d as Data["dashboard"];
      return [
        ["Figure", "This period", "Previous period", "Change"],
        ["Net sales (Rs)", rs(x.sales.net), rs(x.sales.prev), pct(x.sales.change)],
        ["Orders booked", x.orders.count, "", ""],
        ["Order value (Rs)", rs(x.orders.value), rs(x.orders.prev), pct(x.orders.change)],
        ["Average order (Rs)", rs(x.orders.avg), "", ""],
        ["Collected (Rs)", rs(x.collections.received), rs(x.collections.prev), pct(x.collections.change)],
        ["Outstanding today (Rs)", rs(x.outstanding.total), "", ""],
        ["Overdue today (Rs)", rs(x.outstanding.overdue), "", ""],
        ["Stock value (Rs)", rs(x.stock.total), "", ""],
        ["Delivered", x.delivery.delivered, "", ""],
        ["Not delivered", x.delivery.failed, "", ""],
        ["On time", pct(x.delivery.onTimeRate), "", ""],
        [],
        ["Day", "Net sales (Rs)"],
        ...x.byDay.map((r) => [r.day, rs(r.net)]),
      ];
    }
    case "sales": {
      const x = d as Data["sales"];
      return [
        ["Product", "SKU", "Category", "Brand", "Quantity", "Net taxable (Rs)", "Share"],
        ...x.mix.products.map((r) => [r.name, r.sku, r.category, r.brand ?? "", r.qty, rs(r.taxable), pct(r.share)]),
        [],
        ["Day", "Net sales with GST (Rs)"],
        ...x.days.map((r) => [r.day, rs(r.net)]),
      ];
    }
    case "retailers": {
      const x = d as Data["retailers"];
      return [
        ["Shop", "Area", "Sales agent", "Orders", "Value (Rs)", "Average order (Rs)", "Previous period (Rs)", "Change", "Orders a month", "Usual gap (days)", "Last order", "Days since", "Risk", "Outstanding (Rs)"],
        ...x.rows.map((r) => [r.outletName, r.area, r.agent ?? "", r.orders, rs(r.value), rs(r.avgOrder), rs(r.prevValue), pct(r.change), r.perMonth, r.usualGap ?? "", r.lastOrder ?? "", r.daysSince ?? "", CHURN_LABEL[r.risk], rs(r.outstanding)]),
      ];
    }
    case "team": {
      const x = d as Data["team"];
      return [
        ["Sales team", "Role", "Orders", "Value (Rs)", "Visits", "Productive", "Strike rate", "Shops visited", "Collected (Rs)", `Target ${x.month} (Rs)`, "Achieved (Rs)", "Achieved %"],
        ...x.sales.map((r) => [r.name, r.role, r.orders, rs(r.value), r.visits, r.productive, pct(r.strikeRate), r.shops, rs(r.collected), rs(r.target?.goal), rs(r.target?.achieved), r.target ? pct(r.target.pct) : ""]),
        [],
        ["Drivers", "Delivered", "Not delivered", "Success", "On time", "Trips", "Cash collected (Rs)"],
        ...x.drivers.map((r) => [r.name, r.delivered, r.failed, pct(r.successRate), pct(r.onTimeRate), r.trips, rs(r.cash)]),
      ];
    }
    case "stock": {
      const x = d as Data["stock"];
      return [
        ["Figure", "Value (Rs)"],
        ["Stock value (sellable)", rs(x.total)],
        ["In warehouses", rs(x.warehouse)],
        ["In vans", rs(x.van)],
        ["Expiring in 30 days", rs(x.nearExpiry)],
        ["Expired, still in stock", rs(x.expired)],
        ["Damaged bin", rs(x.damaged)],
        [],
        ["Product", "Quantity", "Value (Rs)", "Share"],
        ...x.top.map((r) => [r.name, r.qty, rs(r.value), pct(r.share)]),
      ];
    }
    case "delivery": {
      const x = d as Data["delivery"];
      return [
        ["Figure", "Value"],
        ["Delivered", x.delivered],
        ["Not delivered", x.failed],
        ["Success rate", pct(x.successRate)],
        ["On time", pct(x.onTimeRate)],
        ["First attempt", pct(x.firstAttemptRate)],
        ["Trips", x.trips],
        ["Drops per trip", x.dropsPerTrip],
        ["Short lines", x.shortLines],
        ["Short value (Rs)", rs(x.shortValue)],
        [],
        ["Why not delivered", "Count"],
        ...x.failReasons.map((r) => [r.label, r.count]),
      ];
    }
    case "schemes": {
      const x = d as Data["schemes"];
      return [
        ["Scheme", "Type", "Cost (Rs)", "Free units", "Orders", "Shops", "Sales on scheme orders (Rs)", "Sales per Rs 1", "Shops before (Rs)", "Shops now (Rs)", "Uplift", "Extra sales (Rs)", "ROI (x)", "Budget used"],
        ...x.schemes.map((r) => [r.name, r.type, rs(r.cost), r.freeQty, r.orders, r.shops, rs(r.sales), r.salesPerRupee ?? "", rs(r.before), rs(r.after), pct(r.uplift), rs(r.extra), r.roi ?? "", pct(r.budgetUsed)]),
        [],
        ["Shops with no scheme grew by", !x.fullHistory ? "Records start inside the period before" : x.controlGrowth === null ? "No shops to compare with" : pct(x.controlGrowth)],
      ];
    }
    case "routes": {
      const x = d as Data["routes"];
      return [
        ["Area", "Shops", "Drops", "Net sales (Rs)", "Cost of goods (Rs)", "Gross margin (Rs)", "Margin %", "Delivery cost (Rs)", "Left after delivery (Rs)", "Sales per drop (Rs)", "Sales without a cost (Rs)"],
        ...x.areas.map((r) => [r.name, r.shops, r.drops, rs(r.revenue), rs(r.cogs), rs(r.margin), pct(r.marginPct), rs(r.deliveryCost), rs(r.contribution), rs(r.perDrop), rs(r.uncosted)]),
        [],
        ["Trip", "Date", "Slot", "Driver", "Vehicle", "Drops", "Net sales (Rs)", "Gross margin (Rs)", "Delivery cost (Rs)", "Left (Rs)"],
        ...x.trips.map((t) => [t.number, t.date, t.slot, t.driver, t.vehicle ?? "", t.drops, rs(t.revenue), rs(t.margin), rs(t.deliveryCost), rs(t.contribution)]),
      ];
    }
    case "returns": {
      const x = d as Data["returns"];
      return [
        ["Product", "Sold", "Returned", "Short at delivery", "Damaged", "Value (Rs)", "Return + short rate"],
        ...x.products.map((r) => [r.name, r.sold, r.returned, r.short, r.damaged, rs(r.value), pct(r.rate)]),
        [],
        ["Shop", "Credited (Rs)", "Sales (Rs)", "Rate"],
        ...x.shops.map((r) => [r.outletName, rs(r.credited), rs(r.sales), pct(r.rate)]),
        [],
        ["Credit note reason", "Notes", "Value (Rs)"],
        ...x.reasons.map((r) => [r.reason, r.count, rs(r.value)]),
      ];
    }
  }
}

export type ReportKind = keyof Data;
export const REPORT_KINDS: ReportKind[] = ["dashboard", "sales", "retailers", "team", "stock", "delivery", "schemes", "routes", "returns"];
export const isReportKind = (v: unknown): v is ReportKind => typeof v === "string" && (REPORT_KINDS as string[]).includes(v);
