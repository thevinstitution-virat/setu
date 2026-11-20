/**
 * Cart rules, stored in Tenant.settings.cart (Admin → Settings). Every field
 * has a safe default: no minimum, free delivery, next-day delivery any day.
 */
export type CartSettings = {
  /** Paise of goods (after discounts, before GST) needed to place an order; 0 = none. */
  minOrderValue: number;
  /** Paise added before GST when goods are below freeDeliveryAbove; 0 = free. */
  deliveryCharge: number;
  /** Paise of goods from which delivery is free; null = always charge. */
  freeDeliveryAbove: number | null;
  /** GST % on the delivery charge. */
  deliveryGstRate: number;
  /** "HH:MM" IST. Orders after it are delivered a day later. "" = no cut-off. */
  cutoffTime: string;
  /** Days from order to the earliest delivery (0 = same day). */
  leadDays: number;
  /** Weekdays with no delivery, 0 = Sunday … 6 = Saturday. */
  closedWeekdays: number[];
  /** YYYY-MM-DD dates with no delivery. */
  holidays: string[];
  /** Retailers may pick a later delivery day. */
  allowDateChoice: boolean;
  /** How many delivery days to offer when they can choose. */
  maxDaysAhead: number;
};

export const CART_DEFAULTS: CartSettings = {
  minOrderValue: 0,
  deliveryCharge: 0,
  freeDeliveryAbove: null,
  deliveryGstRate: 18,
  cutoffTime: "",
  leadDays: 1,
  closedWeekdays: [],
  holidays: [],
  allowDateChoice: false,
  maxDaysAhead: 7,
};

export function cartSettings(settings: unknown): CartSettings {
  const c = ((settings ?? {}) as { cart?: Partial<CartSettings> }).cart ?? {};
  return { ...CART_DEFAULTS, ...c };
}

const isInt = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export function parseCartSettings(input: Record<string, unknown>): Partial<CartSettings> | string {
  const out: Partial<CartSettings> = {};
  const MAXP = 100_000_000_00; // ₹10 crore
  if ("minOrderValue" in input) {
    if (!isInt(input.minOrderValue, 0, MAXP)) return "Minimum order value must be 0 or more";
    out.minOrderValue = input.minOrderValue as number;
  }
  if ("deliveryCharge" in input) {
    if (!isInt(input.deliveryCharge, 0, MAXP)) return "Delivery charge must be 0 or more";
    out.deliveryCharge = input.deliveryCharge as number;
  }
  if ("freeDeliveryAbove" in input) {
    if (input.freeDeliveryAbove !== null && !isInt(input.freeDeliveryAbove, 0, MAXP)) return "Free delivery amount must be 0 or more";
    out.freeDeliveryAbove = input.freeDeliveryAbove as number | null;
  }
  if ("deliveryGstRate" in input) {
    if (![0, 5, 12, 18, 28].includes(input.deliveryGstRate as number)) return "Delivery GST must be 0, 5, 12, 18 or 28%";
    out.deliveryGstRate = input.deliveryGstRate as number;
  }
  if ("cutoffTime" in input) {
    if (typeof input.cutoffTime !== "string" || (input.cutoffTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.cutoffTime))) return "Cut-off time must be HH:MM";
    out.cutoffTime = input.cutoffTime;
  }
  if ("leadDays" in input) {
    if (!isInt(input.leadDays, 0, 14)) return "Delivery lead time must be 0 to 14 days";
    out.leadDays = input.leadDays as number;
  }
  if ("closedWeekdays" in input) {
    const w = input.closedWeekdays;
    if (!Array.isArray(w) || w.some((d) => !isInt(d, 0, 6)) || new Set(w).size === 7) return "Closed days must be weekdays 0–6, with at least one open day";
    out.closedWeekdays = [...new Set(w as number[])].sort();
  }
  if ("holidays" in input) {
    const h = input.holidays;
    if (!Array.isArray(h) || h.length > 100 || h.some((d) => typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d))) return "Holidays must be YYYY-MM-DD dates";
    out.holidays = [...new Set(h as string[])].sort();
  }
  if ("allowDateChoice" in input) out.allowDateChoice = input.allowDateChoice === true;
  if ("maxDaysAhead" in input) {
    if (!isInt(input.maxDaysAhead, 1, 30)) return "Days ahead must be 1 to 30";
    out.maxDaysAhead = input.maxDaysAhead as number;
  }
  return out;
}

const IST_MS = 5.5 * 60 * 60 * 1000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Delivery charge (paise, before GST) for this much goods value. */
export function deliveryChargeFor(s: CartSettings, goods: number): number {
  if (s.deliveryCharge <= 0) return 0;
  if (s.freeDeliveryAbove !== null && goods >= s.freeDeliveryAbove) return 0;
  return s.deliveryCharge;
}

/**
 * Delivery days a retailer can get, as IST "YYYY-MM-DD", earliest first.
 * One day unless date choice is on.
 */
export function deliveryDays(s: CartSettings, now = new Date()): string[] {
  const ist = new Date(now.getTime() + IST_MS); // UTC fields now read as IST
  const hhmm = `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
  const lead = s.leadDays + (s.cutoffTime && hhmm >= s.cutoffTime ? 1 : 0);
  const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + lead));
  const want = s.allowDateChoice ? s.maxDaysAhead : 1;
  const out: string[] = [];
  for (let guard = 0; out.length < want && guard < 60; guard++) {
    if (!s.closedWeekdays.includes(day.getUTCDay()) && !s.holidays.includes(ymd(day))) out.push(ymd(day));
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}
