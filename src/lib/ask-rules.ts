/**
 * A11 "Ask your business", the reading part (client-safe, no database).
 * A question in Hindi, Hinglish or English is turned into one of a fixed set
 * of report questions with a few numbers (amount, days, period, how many).
 * Answers are always worked out by the fixed report queries in lib/ask.ts;
 * nothing here (or the AI that may stand in for it) writes SQL or numbers.
 */
import { plainKey } from "@/lib/translit";
import type { Preset } from "@/lib/report-periods";

export const INTENTS = {
  dues: "Shops that owe money (amount, how old)",
  collections: "Money collected in a period, by method",
  sales_total: "Total sales and orders in a period, against the period before",
  top_products: "Products that sold most (or least) in a period",
  top_shops: "Shops that bought most (or least) in a period",
  inactive_shops: "Shops that haven't ordered for some days",
  agent_sales: "Sales and collections by each salesperson in a period",
  low_stock: "Products at or below their reorder level",
  pending_orders: "Orders not delivered yet, by stage",
} as const;
export type Intent = keyof typeof INTENTS;
export const INTENT_KEYS = Object.keys(INTENTS) as Intent[];

export type AskPeriod = Preset | { days: number };
export type AskParams = {
  /** Paise. dues: owing at least this. */
  minAmount?: number;
  /** dues: oldest bill at least this old; inactive_shops: no order for this long. */
  minDays?: number;
  period?: AskPeriod;
  /** How many rows (top 5). */
  limit?: number;
  /** Least instead of most. */
  bottom?: boolean;
  /** dues: only overdue amounts count. */
  overdueOnly?: boolean;
};
export type AskQuery = { intent: Intent; params: AskParams };

export const MAX_QUESTION = 300;
export const MAX_LIMIT = 50;

export const EXAMPLES = [
  "Who owes more than ₹20,000 for over 30 days?",
  "Is mahine kitni sale hui?",
  "Top 10 products last month",
  "कौन सी दुकानों ने 15 दिन से ऑर्डर नहीं किया?",
  "Kisne kitna becha is hafte?",
  "Kaunsa maal khatam hone wala hai?",
  "Aaj kitna collection hua?",
  "Pending orders",
];

const WORD_NUM: Record<string, number> = {
  ek: 1, one: 1, do: 2, two: 2, tin: 3, three: 3, char: 4, four: 4, panch: 5, five: 5, chhe: 6, che: 6, six: 6, sat: 7, seven: 7,
  ath: 8, eight: 8, nau: 9, nine: 9, das: 10, ten: 10, pandrah: 15, pandra: 15, fifteen: 15, bis: 20, twenty: 20, tis: 30, thirty: 30,
  chalis: 40, forty: 40, pachas: 50, fifty: 50, sath: 60, sixty: 60, nabbe: 90, ninety: 90, sau: 100, hundred: 100,
};
const AMOUNT_UNIT: Record<string, number> = { k: 1000, hazar: 1000, hajar: 1000, thousand: 1000, lakh: 100_000, lac: 100_000, lakhs: 100_000, crore: 10_000_000, cr: 10_000_000 };
const DAY_UNIT: Record<string, number> = {
  din: 1, dino: 1, day: 1, days: 1, hafta: 7, hafte: 7, hafton: 7, week: 7, weeks: 7, wik: 7, wiks: 7, mahina: 30, mahine: 30, mahino: 30, month: 30, months: 30, sal: 365, saal: 365, year: 365, years: 365,
};

/** Lower-case Latin words, Devanagari spelled out, long vowels shortened (aa → a, ii/ee → i, uu/oo → u; so "week" reads "wik"). */
export function normalizeQuestion(q: string) {
  // ऑ / ॉ (as in ऑर्डर) aren't in the letter table: read them as ओ / ो.
  const digits = q.slice(0, MAX_QUESTION).replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - 0x0966)).replace(/ऑ/g, "ओ").replace(/ॉ/g, "ो");
  const money = digits.replace(/(\d),(?=\d)/g, "$1").replace(/₹|\brs\.?|\binr\b|रुपये|रुपए|रु\./gi, " rs ");
  const plain = plainKey(money.replace(/(\d)\.(\d)/g, "$1dot$2")).replace(/(\d)dot(\d)/g, "$1.$2");
  return plain
    .replace(/aa/g, "a")
    .replace(/ii|ee/g, "i")
    .replace(/uu|oo/g, "u")
    .replace(/\bordar(s?)\b/g, "order$1")
    .replace(/\b(nahin|nahi|nhin|nhi|nai)\b/g, "nahi")
    .replace(/\s+/g, " ")
    .trim();
}

const has = (t: string, re: RegExp) => re.test(t);

function intentOf(t: string): Intent | null {
  if (has(t, /\b(stock|reorder|khatam|khtm|out of stock|finish)/)) return "low_stock";
  if (has(t, /\b(collection|collect|collected|vasuli|wasuli|vsuli|received|jama hu|payment (aya|mila|ai))/)) return "collections";
  if (has(t, /\border/) && has(t, /\b(pending|deliver nahi|not delivered|undelivered|open|abhi tak|atka|stuck|pack nahi)/)) return "pending_orders";
  if (has(t, /\b(baki|bakaya|udhar|udhari|owe|owes|owing|outstanding|due|dues|overdue|karz|karza|lena hai|dena hai|pending payment|payment pending|unpaid)\b/)) return "dues";
  if ((has(t, /\b(nahi|na|not|no|never|without)\b/) && has(t, /\b(order|orders|ordered|kharid|kharida|liya|bought)\b/)) || has(t, /\b(inactive|stopped|band kar|gayab|missing|lost|churn|dormant)\b/)) return "inactive_shops";
  if (has(t, /\b(agent|agents|salesman|salesmen|salesperson|staff|team|karmachari|kisne|ladk|ladke|employee)/)) return "agent_sales";
  if (has(t, /\b(product|products|item|items|saman|saman|mal|maal|sku|brand|brands)\b/) || has(t, /\b(kya|which|what|kaun ?sa|kaunsa|konsa)\b.*\b(bika|biki|bikta|bikti|bikne|bikta|selling|sold|seller|sell)/)) return "top_products";
  if (has(t, /\b(shop|shops|dukan|dukane|dukano|retailer|retailers|customer|customers|grahak|party|parties|outlet|outlets|store|stores)\b/)) return "top_shops";
  if (has(t, /\b(orders?)\b/) && has(t, /\b(kitne|how many|count|aaj|aj|today)\b/)) return "pending_orders";
  if (has(t, /\b(sale|sales|bikri|bikri|revenue|turnover|kamai|dhand|dhandha|dhanda|business|bika|biki|becha|bechi|total|income)\b/)) return "sales_total";
  return null;
}

function num(w: string | undefined): number | null {
  if (!w) return null;
  if (/^\d+(\.\d+)?$/.test(w)) return Number(w);
  return WORD_NUM[w] ?? null;
}

/** "20000", "20k", "20 hazar", "2 lakh", "rs 500" → rupees. Numbers with a days word are skipped. */
function amountOf(words: string[]): number | null {
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const k = /^(\d+(?:\.\d+)?)(k|l|cr)$/.exec(w);
    if (k) return Number(k[1]) * (k[2] === "k" ? 1000 : k[2] === "l" ? 100_000 : 10_000_000);
    const n = num(w);
    if (n === null) continue;
    const next = words[i + 1];
    if (next && DAY_UNIT[next]) continue;
    if (next && AMOUNT_UNIT[next]) return n * AMOUNT_UNIT[next];
    if (words[i - 1] === "rs" || next === "rs" || next === "rupaye" || next === "rupees" || next === "rupay") return n;
    if (/^\d/.test(w) && n >= 500) return n;
  }
  return null;
}

/** "30 din", "ek mahine", "2 weeks", "over a month" → days. */
function daysOf(words: string[]): number | null {
  for (let i = 0; i < words.length; i++) {
    const unit = DAY_UNIT[words[i]];
    if (!unit) continue;
    const n = num(words[i - 1]);
    if (n !== null) return Math.round(n * unit);
    if (["a", "an", "1"].includes(words[i - 1] ?? "") || unit >= 7) return unit;
  }
  return null;
}

/** The time a question is about. Days said with "pichhle / last / past" (or alone, for sales) make a period. */
function periodOf(t: string, words: string[], daysAsPeriod: boolean): AskPeriod | null {
  if (has(t, /\b(aj|today|abhi tak aj)\b/)) return "today";
  if (has(t, /\b(kal|yesterday|bita kal)\b/)) return "yesterday";
  if (has(t, /\b(pichl[ae]|pichhl[ae]|last|previous|gaye|gya|gaya) (mahin[ae]|month)\b/)) return "last_month";
  if (has(t, /\b(is|this|current|chalu) (mahin[ae]|month)\b|\bmtd\b/)) return "mtd";
  if (has(t, /\b(is|this) (sal|year)\b|\b(fy|financial year|sal bhar|is varsh)\b/)) return "fy";
  if (has(t, /\b(is|this) (hafte|hafta|week|wik)\b/)) return "7d";
  if (has(t, /\b(quarter|timahi|3 mahin[ae]|tin mahin[ae])\b/)) return "90d";
  const d = daysOf(words);
  if (d && (daysAsPeriod || has(t, /\b(pichl[ae]|pichhl[ae]|last|past|gaye|bite)\b/))) {
    if (d === 7) return "7d";
    if (d === 30) return "30d";
    if (d === 90) return "90d";
    return { days: Math.min(366, Math.max(1, d)) };
  }
  if (has(t, /\b(mahin[ae]|month)\b/)) return "mtd";
  if (has(t, /\b(hafte|hafta|week|wik)\b/)) return "7d";
  return null;
}

function limitOf(words: string[]): number | null {
  for (let i = 0; i < words.length; i++) {
    if (["top", "best", "sabse", "first", "pehle", "bottom", "last"].includes(words[i])) {
      const after = num(words[i + 1]);
      const n = after !== null && DAY_UNIT[words[i + 2]] ? null : (after ?? num(words[i - 1]));
      if (n !== null && n >= 1 && n <= MAX_LIMIT && Number.isInteger(n)) return n;
    }
  }
  return null;
}

/** A question → a fixed report question, or null when the rules can't tell. */
export function readQuestion(question: string): AskQuery | null {
  const t = normalizeQuestion(question);
  if (!t) return null;
  const intent = intentOf(t);
  if (!intent) return null;
  const words = t.split(" ");
  const params: AskParams = {};
  const limit = limitOf(words);
  if (limit) params.limit = limit;
  if (has(t, /\b(least|lowest|worst|slowest|slow|bottom|sabse kam|kam bik|kam bika|kam biki)\b/)) params.bottom = true;

  if (intent === "dues") {
    const amount = amountOf(words);
    if (amount) params.minAmount = Math.round(amount * 100);
    const days = daysOf(words);
    if (days) params.minDays = days;
    if (has(t, /\b(overdue|late|der|due date|samay se|time se)\b/)) params.overdueOnly = true;
  } else if (intent === "inactive_shops") {
    params.minDays = daysOf(words) ?? 30;
  } else if (intent !== "low_stock" && intent !== "pending_orders") {
    const p = periodOf(t, words, intent === "sales_total" || intent === "collections" || intent === "top_products" || intent === "top_shops" || intent === "agent_sales");
    if (p) params.period = p;
  }
  return { intent, params };
}

/** Checks what the AI (or a caller) sends: intents from the list only, numbers in range. */
export function cleanQuery(q: { intent: string; params?: Partial<Record<keyof AskParams, unknown>> | null }): AskQuery | null {
  if (!INTENT_KEYS.includes(q.intent as Intent)) return null;
  const p = q.params ?? {};
  const out: AskParams = {};
  const int = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : undefined);
  const minAmount = int(p.minAmount, 1, 1e12);
  if (minAmount) out.minAmount = minAmount;
  const minDays = int(p.minDays, 1, 3650);
  if (minDays) out.minDays = minDays;
  const limit = int(p.limit, 1, MAX_LIMIT);
  if (limit) out.limit = limit;
  if (p.bottom === true) out.bottom = true;
  if (p.overdueOnly === true) out.overdueOnly = true;
  const per = p.period;
  if (typeof per === "string" && ["today", "yesterday", "7d", "30d", "mtd", "last_month", "90d", "fy"].includes(per)) out.period = per as Preset;
  else if (per && typeof per === "object" && "days" in per) {
    const d = int((per as { days: unknown }).days, 1, 366);
    if (d) out.period = { days: d };
  }
  return { intent: q.intent as Intent, params: out };
}
