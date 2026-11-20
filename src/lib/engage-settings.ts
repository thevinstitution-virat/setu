/**
 * Phase 7 rules, stored in Tenant.settings: `notify` (messages), `support`
 * (complaints and feedback) and `referral` (refer and earn). Client-safe.
 */
import { EVENTS, type EventKey } from "@/lib/notify-events";

export type Channel = "sms" | "whatsapp" | "push";
export const CHANNELS: Channel[] = ["push", "whatsapp", "sms"];

export type NotifySettings = {
  /** Channels this business uses at all. In-app notifications are always on. */
  channels: Record<Channel, boolean>;
  /** Per event: which channels send it (only where the channel itself is on). */
  events: Partial<Record<EventKey, Partial<Record<Channel, boolean>>>>;
  /** Payment reminders for overdue bills, sent at 10:00 IST on these days past due. */
  reminders: { on: boolean; days: number[] };
  /** Send each retailer with a balance a statement on the 1st of the month. */
  monthlyStatement: boolean;
};

export const NOTIFY_DEFAULTS: NotifySettings = {
  channels: { push: true, whatsapp: false, sms: false },
  events: {},
  reminders: { on: true, days: [1, 7, 15] },
  monthlyStatement: false,
};

export function notifySettings(settings: unknown): NotifySettings {
  const d = ((settings ?? {}) as { notify?: Partial<NotifySettings> }).notify ?? {};
  return {
    channels: { ...NOTIFY_DEFAULTS.channels, ...(d.channels ?? {}) },
    events: d.events ?? {},
    reminders: { ...NOTIFY_DEFAULTS.reminders, ...(d.reminders ?? {}) },
    monthlyStatement: d.monthlyStatement === true,
  };
}

/** Does this event go out on this channel? (business channel on, then the event's own choice or its default) */
export function eventOn(s: NotifySettings, event: EventKey, channel: Channel): boolean {
  if (!s.channels[channel]) return false;
  const own = s.events[event]?.[channel];
  if (typeof own === "boolean") return own;
  return (EVENTS[event].channels as readonly string[]).includes(channel);
}

export function parseNotifySettings(input: Record<string, unknown>): Partial<NotifySettings> | string {
  const out: Partial<NotifySettings> = {};
  if ("channels" in input) {
    const c = input.channels as Record<string, unknown> | null;
    if (!c || typeof c !== "object") return "Channels must be on or off";
    out.channels = { push: c.push === true, whatsapp: c.whatsapp === true, sms: c.sms === true };
  }
  if ("events" in input) {
    const e = input.events as Record<string, unknown> | null;
    if (!e || typeof e !== "object") return "Pick channels per message";
    const events: NotifySettings["events"] = {};
    for (const [k, v] of Object.entries(e)) {
      if (!(k in EVENTS)) return `Unknown message ${k}`;
      if (!v || typeof v !== "object") continue;
      const row: Partial<Record<Channel, boolean>> = {};
      for (const ch of CHANNELS) if (typeof (v as Record<string, unknown>)[ch] === "boolean") row[ch] = (v as Record<string, boolean>)[ch];
      events[k as EventKey] = row;
    }
    out.events = events;
  }
  if ("reminders" in input) {
    const r = input.reminders as { on?: unknown; days?: unknown } | null;
    if (!r || typeof r !== "object") return "Reminders must be on or off";
    const days = Array.isArray(r.days) ? r.days : [];
    if (days.length > 6) return "Up to 6 reminder days";
    for (const d of days) if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 120) return "Reminder days must be 0 to 120";
    out.reminders = { on: r.on === true, days: [...new Set(days as number[])].sort((a, b) => a - b) };
  }
  if ("monthlyStatement" in input) out.monthlyStatement = input.monthlyStatement === true;
  return out;
}

// ───────────────────────────── complaints and feedback ─────────────────────────────

export const TICKET_CATEGORIES = {
  damaged: { label: "Damaged goods", hi: "माल टूटा / खराब", sla: 24 },
  missing: { label: "Item missing", hi: "सामान कम आया", sla: 24 },
  wrong_item: { label: "Wrong item", hi: "गलत सामान", sla: 24 },
  expired: { label: "Expired or near expiry", hi: "एक्सपायरी वाला माल", sla: 24 },
  late: { label: "Late or no delivery", hi: "डिलीवरी देर से / नहीं हुई", sla: 48 },
  billing: { label: "Bill or price problem", hi: "बिल या रेट में गलती", sla: 72 },
  payment: { label: "Payment not shown", hi: "पेमेंट नहीं दिख रहा", sla: 48 },
  staff: { label: "Staff behaviour", hi: "स्टाफ का व्यवहार", sla: 72 },
  other: { label: "Other", hi: "अन्य", sla: 72 },
} as const;
export type TicketCategory = keyof typeof TICKET_CATEGORIES;

export type TicketStatusName = "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";
/** The moves the office may make (the server checks these; screens show only these buttons). */
export const TICKET_NEXT: Record<TicketStatusName, TicketStatusName[]> = {
  OPEN: ["IN_PROGRESS", "WAITING", "RESOLVED"],
  IN_PROGRESS: ["WAITING", "RESOLVED"],
  WAITING: ["IN_PROGRESS", "RESOLVED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};
export const isTicketCategory = (v: unknown): v is TicketCategory => typeof v === "string" && v in TICKET_CATEGORIES;

export type SupportSettings = {
  /** Hours to resolve, per category (the SLA clock runs round the clock). */
  slaHours: Partial<Record<TicketCategory, number>>;
  /** Resolved complaints close by themselves after this many days unless the retailer reopens. */
  autoCloseDays: number;
  /** Retailers can rate a delivery for this many days. */
  feedbackDays: number;
  /** A rating at or below this tells the office. */
  lowRating: number;
};

export const SUPPORT_DEFAULTS: SupportSettings = { slaHours: {}, autoCloseDays: 3, feedbackDays: 7, lowRating: 2 };

export function supportSettings(settings: unknown): SupportSettings {
  const d = ((settings ?? {}) as { support?: Partial<SupportSettings> }).support ?? {};
  return { ...SUPPORT_DEFAULTS, ...d, slaHours: { ...(d.slaHours ?? {}) } };
}

export function slaHoursFor(s: SupportSettings, c: TicketCategory): number {
  const v = s.slaHours[c];
  return typeof v === "number" && v > 0 ? v : TICKET_CATEGORIES[c].sla;
}

export function parseSupportSettings(input: Record<string, unknown>): Partial<SupportSettings> | string {
  const out: Partial<SupportSettings> = {};
  if ("slaHours" in input) {
    const h = input.slaHours as Record<string, unknown> | null;
    if (!h || typeof h !== "object") return "Pick hours per complaint type";
    const sla: SupportSettings["slaHours"] = {};
    for (const [k, v] of Object.entries(h)) {
      if (!isTicketCategory(k)) return `Unknown complaint type ${k}`;
      if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 720) return "Hours to resolve must be 1 to 720";
      sla[k] = v;
    }
    out.slaHours = sla;
  }
  const int = (k: "autoCloseDays" | "feedbackDays" | "lowRating", min: number, max: number, label: string) => {
    if (!(k in input)) return null;
    const v = input[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return `${label} must be ${min} to ${max}`;
    out[k] = v;
    return null;
  };
  const e = int("autoCloseDays", 1, 30, "Close resolved complaints after (days)") ?? int("feedbackDays", 1, 30, "Days to rate a delivery") ?? int("lowRating", 1, 4, "Low rating");
  return e ?? out;
}

export const FEEDBACK_TAGS = {
  on_time: { label: "On time", hi: "समय पर", good: true },
  polite: { label: "Polite staff", hi: "अच्छा व्यवहार", good: true },
  packed_well: { label: "Packed well", hi: "अच्छी पैकिंग", good: true },
  late: { label: "Late", hi: "देर से", good: false },
  rude: { label: "Rude staff", hi: "बुरा व्यवहार", good: false },
  damaged: { label: "Damaged goods", hi: "टूटा-फूटा माल", good: false },
  short: { label: "Items short", hi: "सामान कम", good: false },
} as const;
export type FeedbackTag = keyof typeof FEEDBACK_TAGS;

// ───────────────────────────── refer and earn ─────────────────────────────

export type ReferralSettings = {
  on: boolean;
  /** Paise credited to the referring shop's wallet. */
  referrerReward: number;
  /** Paise credited to the new shop's wallet (0 = none). */
  refereeReward: number;
  /** The new shop's first delivered order must be at least this (paise, goods after discounts, before GST). */
  minOrder: number;
  /** ... and delivered within this many days of signing up. */
  validDays: number;
  /** At most this many rewards per referring shop per month. */
  monthlyCap: number;
};

export const REFERRAL_DEFAULTS: ReferralSettings = { on: false, referrerReward: 20_000, refereeReward: 0, minOrder: 200_000, validDays: 60, monthlyCap: 10 };

export function referralSettings(settings: unknown): ReferralSettings {
  const d = ((settings ?? {}) as { referral?: Partial<ReferralSettings> }).referral ?? {};
  return { ...REFERRAL_DEFAULTS, ...d };
}

export function parseReferralSettings(input: Record<string, unknown>): Partial<ReferralSettings> | string {
  const out: Partial<ReferralSettings> = {};
  if ("on" in input) out.on = input.on === true;
  const int = (k: Exclude<keyof ReferralSettings, "on">, min: number, max: number, label: string) => {
    if (!(k in input)) return null;
    const v = input[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return `${label} must be ${min} to ${max}`;
    out[k] = v;
    return null;
  };
  const e =
    int("referrerReward", 0, 10_000_00, "Reward for the shop that refers (paise)") ??
    int("refereeReward", 0, 10_000_00, "Reward for the new shop (paise)") ??
    int("minOrder", 0, 1_000_000_00, "Minimum first order (paise)") ??
    int("validDays", 7, 365, "Days to place the first order") ??
    int("monthlyCap", 1, 100, "Rewards per shop per month");
  return e ?? out;
}
