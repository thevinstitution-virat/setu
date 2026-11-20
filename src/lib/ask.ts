/**
 * A11 "Ask your business" (server). The question is read by the rules
 * (lib/ask-rules.ts); when they can't tell and the business has AI, the AI
 * picks one of the same fixed report questions and its numbers (never SQL,
 * never the answer). The answer is then worked out by the report queries in
 * lib/analytics.ts and lib/stock.ts, so every number on screen comes from the
 * books, the same as the Reports pages.
 */
import * as z from "zod";
import { withTenantTx, type Tx } from "@/lib/db";
import { aiJson, aiStatus } from "@/lib/ai";
import { formatINR } from "@/lib/money";
import { addDay, istDay } from "@/lib/field-math";
import { agentPerformance, collections, orderTotals, outstanding, productMix, retailerAnalytics, salesTotals } from "@/lib/analytics";
import { PRESETS, change, makePeriod, presetPeriod, previousPeriod, type Period } from "@/lib/report-periods";
import { reorderList } from "@/lib/stock";
import { inventorySettings } from "@/lib/inventory-settings";
import { INTENTS, INTENT_KEYS, MAX_LIMIT, MAX_QUESTION, cleanQuery, readQuestion, type AskParams, type AskPeriod, type AskQuery, type Intent } from "@/lib/ask-rules";
import { HOUR, limited } from "@/lib/rate-limit";

export type Column = { key: string; label: string; kind: "text" | "money" | "number" | "pct" | "days" };
export type Row = Record<string, string | number | null>;
export type AskAnswer = {
  intent: Intent;
  params: AskParams;
  /** What we understood, as chips: "More than ₹20,000", "Over 30 days". */
  understood: string[];
  title: string;
  summary: string;
  columns: Column[];
  rows: Row[];
  /** The report page with the full picture. */
  link: string | null;
  source: "rules" | "ai";
  credits: number;
  note: string | null;
};
export type AskResult = { ok: true; answer: AskAnswer } | { ok: false; message: string; note: string | null };

const SYSTEM = `You turn a distributor's question about their business (Hindi, Hinglish or English) into one fixed report question.
Pick the intent that answers it, and only the params the question says. Amounts are in paise (₹1 = 100 paise; "20 hazar" = 2000000). Days are whole days ("ek mahina" = 30).
period is one of: today, yesterday, 7d, 30d, mtd (this month), last_month, 90d, fy (this financial year), or {"days": N} for the last N days.
If no intent fits, answer {"intent": null}.`;

const schema = z.object({
  intent: z.enum(INTENT_KEYS as [Intent, ...Intent[]]).nullable(),
  params: z
    .object({
      minAmount: z.number().nullable().optional(),
      minDays: z.number().nullable().optional(),
      period: z.union([z.string(), z.object({ days: z.number() })]).nullable().optional(),
      limit: z.number().nullable().optional(),
      bottom: z.boolean().nullable().optional(),
      overdueOnly: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
});

function periodFor(p: AskPeriod | undefined, now: Date, fallback: keyof typeof PRESETS = "mtd"): Period {
  if (!p) return presetPeriod(fallback, now);
  if (typeof p === "string") return presetPeriod(p, now);
  const to = istDay(now);
  return makePeriod(addDay(to, -(p.days - 1)), to);
}
const periodLabel = (p: AskPeriod | undefined, fallback: keyof typeof PRESETS = "mtd") => (!p ? PRESETS[fallback] : typeof p === "string" ? PRESETS[p] : `Last ${p.days} days`);
const rs = (paise: number) => formatINR(paise, { whole: true });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pctText = (c: number | null, vs: string) => (c === null ? "" : ` (${c >= 0 ? "up" : "down"} ${Math.abs(c)}% on ${vs})`);

/** Works out the answer for a query. Read-only; every number comes from the report queries. */
export async function answerQuery(tx: Tx, tenantSettings: unknown, q: AskQuery, now = new Date()): Promise<Omit<AskAnswer, "source" | "credits" | "note">> {
  const { intent, params: p } = q;
  const limit = Math.min(MAX_LIMIT, p.limit ?? 10);
  const base = { intent, params: p };

  if (intent === "dues") {
    const o = await outstanding(tx, now, { top: 2000 });
    const value = (d: (typeof o.debtors)[number]) => (p.overdueOnly ? d.overdue : d.outstanding);
    const hits = o.debtors.filter((d) => value(d) > 0 && value(d) >= (p.minAmount ?? 1) && d.oldestDays >= (p.minDays ?? 0)).sort((a, b) => value(b) - value(a));
    const sum = hits.reduce((a, d) => a + value(d), 0);
    const understood = [p.minAmount ? `More than ${rs(p.minAmount)}` : null, p.minDays ? `Oldest bill over ${p.minDays} days` : null, p.overdueOnly ? "Overdue only" : null].filter((x): x is string => !!x);
    return {
      ...base,
      understood,
      title: "Shops that owe money",
      summary: hits.length
        ? `${plural(hits.length, "shop")} ${hits.length === 1 ? "owes" : "owe"} ${rs(sum)}${p.overdueOnly ? " overdue" : ""}${understood.length ? ` (${understood.join(", ").toLowerCase()})` : ""}. All shops together owe ${rs(o.total)}, ${rs(o.overdue)} of it overdue.`
        : `No shop matches${understood.length ? ` (${understood.join(", ").toLowerCase()})` : ""}. All shops together owe ${rs(o.total)}.`,
      columns: [
        { key: "shop", label: "Shop", kind: "text" },
        { key: "area", label: "Area", kind: "text" },
        { key: "outstanding", label: "Owes", kind: "money" },
        { key: "overdue", label: "Overdue", kind: "money" },
        { key: "days", label: "Oldest bill", kind: "days" },
      ],
      rows: hits.slice(0, Math.max(limit, 25)).map((d) => ({ id: d.retailerId, shop: d.outletName, area: d.area, outstanding: d.outstanding, overdue: d.overdue, days: d.oldestDays })),
      link: "/admin/khata",
    };
  }

  if (intent === "collections") {
    const per = periodFor(p.period, now, "today");
    const c = await collections(tx, per);
    return {
      ...base,
      understood: [periodLabel(p.period, "today")],
      title: `Collections · ${periodLabel(p.period, "today")}`,
      summary: `${rs(c.received)} collected${c.pending.count ? `; ${plural(c.pending.count, "payment")} (${rs(c.pending.amount)}) still to check` : ""}.`,
      columns: [
        { key: "method", label: "Method", kind: "text" },
        { key: "count", label: "Payments", kind: "number" },
        { key: "amount", label: "Amount", kind: "money" },
      ],
      rows: c.byMethod.map((m) => ({ method: m.method.replace("_", " ").toLowerCase(), count: m.count, amount: m.amount })),
      link: `/admin/reports/sales?from=${per.from}&to=${per.to}`,
    };
  }

  if (intent === "sales_total") {
    const per = periodFor(p.period, now);
    const prev = previousPeriod(per);
    const [s, sp, o] = await Promise.all([salesTotals(tx, per), salesTotals(tx, prev), orderTotals(tx, per)]);
    const label = periodLabel(p.period);
    return {
      ...base,
      understood: [label],
      title: `Sales · ${label}`,
      summary: `Net sales ${rs(s.net)}${pctText(change(s.net, sp.net), "the period before")} from ${plural(s.invoices, "invoice")}. Orders: ${plural(o.count, "order")} worth ${rs(o.value)}.`,
      columns: [
        { key: "what", label: "", kind: "text" },
        { key: "now", label: label, kind: "money" },
        { key: "before", label: "Period before", kind: "money" },
      ],
      rows: [
        { what: "Net sales", now: s.net, before: sp.net },
        { what: "Before GST", now: s.netTaxable, before: sp.netTaxable },
        { what: "Credit notes", now: s.credits, before: sp.credits },
      ],
      link: `/admin/reports/sales?from=${per.from}&to=${per.to}`,
    };
  }

  if (intent === "top_products") {
    const per = periodFor(p.period, now);
    const mix = await productMix(tx, per);
    const list = p.bottom ? [...mix.products].reverse() : mix.products;
    const label = periodLabel(p.period);
    const top = list.slice(0, limit);
    return {
      ...base,
      understood: [label, `${p.bottom ? "Least" : "Most"} sold`, `${limit} products`],
      title: `${p.bottom ? "Slowest" : "Best-selling"} products · ${label}`,
      summary: top.length ? `${top[0].name} ${p.bottom ? "sold least" : "sold most"}: ${rs(top[0].taxable)} before GST (${top[0].share}% of sales).` : "Nothing was sold in this period.",
      columns: [
        { key: "name", label: "Product", kind: "text" },
        { key: "qty", label: "Units", kind: "number" },
        { key: "sales", label: "Sales (before GST)", kind: "money" },
        { key: "share", label: "Share", kind: "pct" },
      ],
      rows: top.map((r) => ({ id: r.productId, name: r.name, qty: r.qty, sales: r.taxable, share: r.share })),
      link: `/admin/reports/sales?from=${per.from}&to=${per.to}`,
    };
  }

  if (intent === "top_shops") {
    const per = periodFor(p.period, now);
    const rows = (await retailerAnalytics(tx, per)).rows.filter((r) => p.bottom || r.value > 0);
    rows.sort((a, b) => (p.bottom ? a.value - b.value : b.value - a.value));
    const top = rows.slice(0, limit);
    const label = periodLabel(p.period);
    return {
      ...base,
      understood: [label, `${p.bottom ? "Least" : "Most"} bought`, `${limit} shops`],
      title: `${p.bottom ? "Shops that bought least" : "Top shops"} · ${label}`,
      summary: top.length ? `${top[0].outletName} ${p.bottom ? "bought least" : "bought most"}: ${rs(top[0].value)} from ${plural(top[0].orders, "order")}.` : "No orders in this period.",
      columns: [
        { key: "shop", label: "Shop", kind: "text" },
        { key: "area", label: "Area", kind: "text" },
        { key: "orders", label: "Orders", kind: "number" },
        { key: "value", label: "Value", kind: "money" },
        { key: "change", label: "Change", kind: "pct" },
      ],
      rows: top.map((r) => ({ id: r.retailerId, shop: r.outletName, area: r.area, orders: r.orders, value: r.value, change: r.change })),
      link: `/admin/reports/shops?from=${per.from}&to=${per.to}`,
    };
  }

  if (intent === "inactive_shops") {
    const days = p.minDays ?? 30;
    const rows = (await retailerAnalytics(tx, presetPeriod("30d", now))).rows.filter((r) => r.daysSince === null || r.daysSince >= days);
    rows.sort((a, b) => (b.daysSince ?? 1e9) - (a.daysSince ?? 1e9));
    const never = rows.filter((r) => r.daysSince === null).length;
    return {
      ...base,
      understood: [`No order for ${days}+ days`],
      title: `Shops with no order for ${days} days`,
      summary: rows.length ? `${plural(rows.length, "shop")} ${rows.length === 1 ? "hasn't" : "haven't"} ordered for ${days} days or more${never ? ` (${never} never ordered)` : ""}.` : `Every shop has ordered in the last ${days} days.`,
      columns: [
        { key: "shop", label: "Shop", kind: "text" },
        { key: "area", label: "Area", kind: "text" },
        { key: "agent", label: "Salesperson", kind: "text" },
        { key: "days", label: "Last order", kind: "days" },
        { key: "outstanding", label: "Owes", kind: "money" },
      ],
      rows: rows.slice(0, Math.max(limit, 25)).map((r) => ({ id: r.retailerId, shop: r.outletName, area: r.area, agent: r.agent, days: r.daysSince, outstanding: r.outstanding })),
      link: "/admin/reports/shops",
    };
  }

  if (intent === "agent_sales") {
    const per = periodFor(p.period, now);
    const a = await agentPerformance(tx, per);
    const rows = p.bottom ? [...a.sales].reverse() : a.sales;
    const label = periodLabel(p.period);
    return {
      ...base,
      understood: [label],
      title: `Sales by person · ${label}`,
      summary: rows.length && rows[0].value ? `${rows[0].name} ${p.bottom ? "sold least" : "sold most"}: ${rs(rows[0].value)} from ${plural(rows[0].orders, "order")}.` : "No orders by the field team in this period.",
      columns: [
        { key: "name", label: "Name", kind: "text" },
        { key: "orders", label: "Orders", kind: "number" },
        { key: "value", label: "Value", kind: "money" },
        { key: "visits", label: "Visits", kind: "number" },
        { key: "strike", label: "Strike rate", kind: "pct" },
        { key: "collected", label: "Collected", kind: "money" },
      ],
      rows: rows.slice(0, limit).map((r) => ({ id: r.userId, name: r.name, orders: r.orders, value: r.value, visits: r.visits, strike: r.strikeRate, collected: r.collected })),
      link: `/admin/reports/team?from=${per.from}&to=${per.to}`,
    };
  }

  if (intent === "low_stock") {
    if (!inventorySettings(tenantSettings).enabled) {
      return { ...base, understood: [], title: "Low stock", summary: "Stock tracking is off, so there are no stock levels to check (Settings → Stock).", columns: [], rows: [], link: "/admin/stock" };
    }
    const rows = await reorderList(tx);
    return {
      ...base,
      understood: ["At or below reorder level"],
      title: "Products running low",
      summary: rows.length ? `${plural(rows.length, "product")} at or below the reorder level.` : "Nothing is at or below its reorder level.",
      columns: [
        { key: "name", label: "Product", kind: "text" },
        { key: "available", label: "Available", kind: "number" },
        { key: "level", label: "Reorder at", kind: "number" },
        { key: "onOrder", label: "On order", kind: "number" },
        { key: "supplier", label: "Supplier", kind: "text" },
      ],
      rows: rows.slice(0, Math.max(limit, 25)).map((r) => ({ id: r.productId, name: r.name, available: r.available, level: r.reorderLevel, onOrder: r.onOrder, supplier: r.supplierName })),
      link: "/admin/stock",
    };
  }

  // pending_orders
  const g = await tx.order.groupBy({ by: ["status"], where: { status: { in: ["PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY"] } }, _count: true, _sum: { totalAmount: true } });
  const STAGE: Record<string, string> = { PLACED: "New", CONFIRMED: "Confirmed", PACKED: "Packed", OUT_FOR_DELIVERY: "Out for delivery" };
  const rows = ["PLACED", "CONFIRMED", "PACKED", "OUT_FOR_DELIVERY"].map((s) => {
    const x = g.find((y) => y.status === s);
    return { stage: STAGE[s], count: x?._count ?? 0, value: x?._sum.totalAmount ?? 0 };
  });
  const count = rows.reduce((a, r) => a + r.count, 0);
  const value = rows.reduce((a, r) => a + r.value, 0);
  return {
    ...base,
    understood: ["Not delivered yet"],
    title: "Orders not delivered yet",
    summary: count ? `${plural(count, "order")} worth ${rs(value)} are not delivered yet.` : "Every order is delivered or cancelled.",
    columns: [
      { key: "stage", label: "Stage", kind: "text" },
      { key: "count", label: "Orders", kind: "number" },
      { key: "value", label: "Value", kind: "money" },
    ],
    rows,
    link: "/admin/orders",
  };
}

/** Reads a question and answers it. Never throws for AI trouble. */
export async function ask(o: { tenantId: string; actorId: string | null; question: string; now?: Date }): Promise<AskResult> {
  const now = o.now ?? new Date();
  const question = o.question.slice(0, MAX_QUESTION).trim();
  if (!question) return { ok: false, message: "Ask a question first", note: null };
  let query = readQuestion(question);
  let source: "rules" | "ai" = "rules";
  let credits = 0;
  let note: string | null = null;
  if (!query) {
    const status = await aiStatus(o.tenantId, now);
    // 60 AI-read questions an hour per person; after that only the built-in phrasing works.
    if (status.available && !(o.actorId && (await limited(`ai-ask:${o.tenantId}`, o.actorId, 60, HOUR, now)))) {
      const r = await aiJson({
        tenantId: o.tenantId,
        actorId: o.actorId,
        feature: "ask",
        system: SYSTEM,
        prompt: `Intents:\n${INTENT_KEYS.map((k) => `- ${k}: ${INTENTS[k]}`).join("\n")}\n\nQuestion: """${question}"""`,
        schema,
        maxTokens: 400,
        now,
      });
      if (r.ok) {
        credits = r.credits;
        if (r.data.intent) {
          const params = Object.fromEntries(Object.entries(r.data.params ?? {}).filter(([, v]) => v !== null && v !== undefined));
          query = cleanQuery({ intent: r.data.intent, params });
          if (query) source = "ai";
        }
      } else note = r.message;
    }
  }
  if (!query) {
    return { ok: false, message: "I can answer questions about dues, collections, sales, best-selling products, top or inactive shops, the field team, low stock and pending orders. Try one of the examples.", note };
  }
  const t = await withTenantTx(o.tenantId, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: o.tenantId }, select: { settings: true } }));
  const answer = await withTenantTx(o.tenantId, (tx) => answerQuery(tx, t.settings, query, now), { timeout: 60_000 });
  return { ok: true, answer: { ...answer, source, credits, note } };
}
