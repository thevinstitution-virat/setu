/**
 * Per-business switches and thresholds for the automations (roadmap §7),
 * kept in Tenant.settings.automation. Client-safe (no database).
 *
 * Guardrail: only the visit plan can apply itself (`auto`), because it moves
 * no money and changes no price. Credit changes always need a person.
 */

export type AutomationSettings = {
  /** A7 (+ A4 collection visits): shops each sales agent should see today. */
  visitPlan: { on: boolean; auto: boolean; maxShops: number; minScore: number };
  /** A4: collection visit after N days overdue; stop credit after M days. */
  collections: { on: boolean; visitAfterDays: number; stopAfterDays: number };
  /** A12: weekly risk score and credit-limit suggestions. */
  credit: { on: boolean };
  /** A9: things that may be wrong. cashShort in paise. */
  checks: { on: boolean; cashShort: number; farMetres: number; closedTimes: number; discountPct: number };
  /** A2: "Usual order" button for shops and agents. */
  usualOrder: { on: boolean };
  /** A5: split a day's orders into trips. */
  tripPlan: { on: boolean; maxDrops: number };
  /**
   * A6: demand forecast. Reorder suggestions to suppliers (enough for the
   * supplier's lead time + coverDays, with safety stock for serviceLevel %),
   * and the next-day load sheet (topUp: load up to the usual for that weekday).
   */
  forecast: { on: boolean; coverDays: number; serviceLevel: number; topUp: boolean };
  /**
   * A1: shops and agents type, paste or speak an order and it becomes a cart
   * to check; whatsapp: orders sent to the business's WhatsApp number become
   * drafts the shop confirms in the app.
   */
  orderText: { on: boolean; whatsapp: boolean };
  /** A11: the owner asks questions about the business in Hindi or English. */
  ask: { on: boolean };
};

export const AUTOMATION_DEFAULTS: AutomationSettings = {
  visitPlan: { on: true, auto: false, maxShops: 6, minScore: 25 },
  collections: { on: true, visitAfterDays: 10, stopAfterDays: 30 },
  credit: { on: true },
  checks: { on: true, cashShort: 20_000, farMetres: 300, closedTimes: 3, discountPct: 20 },
  usualOrder: { on: true },
  tripPlan: { on: true, maxDrops: 25 },
  forecast: { on: true, coverDays: 7, serviceLevel: 90, topUp: true },
  orderText: { on: true, whatsapp: true },
  ask: { on: true },
};

export type AutomationKey = keyof AutomationSettings;
export const AUTOMATION_KEYS = Object.keys(AUTOMATION_DEFAULTS) as AutomationKey[];

export function automationSettings(settings: unknown): AutomationSettings {
  const saved = ((settings as { automation?: Partial<Record<AutomationKey, object>> } | null)?.automation ?? {}) as Partial<Record<AutomationKey, object>>;
  const out = {} as Record<AutomationKey, object>;
  for (const k of AUTOMATION_KEYS) out[k] = { ...AUTOMATION_DEFAULTS[k], ...(saved[k] ?? {}) };
  return out as AutomationSettings;
}

const LIMITS: Record<string, [number, number]> = {
  maxShops: [1, 20],
  minScore: [0, 100],
  visitAfterDays: [1, 90],
  stopAfterDays: [7, 180],
  cashShort: [0, 10_000_000],
  farMetres: [50, 5000],
  closedTimes: [2, 10],
  discountPct: [1, 90],
  maxDrops: [3, 100],
  coverDays: [1, 60],
  serviceLevel: [50, 99],
};

/**
 * Checks what the settings screen sends. Each feature present is merged over
 * the defaults (the screen always sends whole features); a string = an error.
 */
export function parseAutomationSettings(input: unknown): Partial<AutomationSettings> | string {
  if (!input || typeof input !== "object") return "Send the automation settings";
  const out: Partial<Record<AutomationKey, object>> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!AUTOMATION_KEYS.includes(k as AutomationKey)) return `Unknown automation: ${k}`;
    if (!v || typeof v !== "object") return `Send ${k} as an object`;
    const def = AUTOMATION_DEFAULTS[k as AutomationKey] as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...def };
    for (const [f, val] of Object.entries(v as Record<string, unknown>)) {
      if (!(f in def)) return `Unknown setting: ${k}.${f}`;
      if (typeof def[f] === "boolean") {
        if (typeof val !== "boolean") return `${k}.${f} must be on or off`;
        merged[f] = val;
      } else {
        const [min, max] = LIMITS[f];
        if (typeof val !== "number" || !Number.isInteger(val) || val < min || val > max) return `${k}.${f} must be a whole number from ${min} to ${max}`;
        merged[f] = val;
      }
    }
    if (k === "collections" && (merged.stopAfterDays as number) <= (merged.visitAfterDays as number)) return "Stop credit must come after the collection visit";
    out[k as AutomationKey] = merged;
  }
  return out as Partial<AutomationSettings>;
}
