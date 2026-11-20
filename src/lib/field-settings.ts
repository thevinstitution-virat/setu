/**
 * Field sales rules, stored in Tenant.settings.field (Admin → Settings →
 * Field team). Client-safe: no server imports.
 */
export type FieldSettings = {
  /** A selfie is required to check in and out. */
  selfie: boolean;
  /** A GPS position is required to check in and out. */
  geo: boolean;
  /** Record positions while on duty (never off duty). Off by default (DPDP: tell staff first). */
  trackLocation: boolean;
  /** Minutes between positions while on duty. */
  pingMinutes: number;
  /** Positions older than this are deleted every night. */
  pingRetentionDays: number;
  /** Check-ins after this time (IST, HH:MM) are late. */
  workStart: string;
  /** A visit checked in further than this from the shop's map pin is flagged. */
  visitRadiusM: number;
  /** Sales agents may visit and order for shops not on their list. Supervisors and admins always may. */
  offBeat: boolean;
};

export const FIELD_DEFAULTS: FieldSettings = {
  selfie: true,
  geo: true,
  trackLocation: false,
  pingMinutes: 5,
  pingRetentionDays: 90,
  workStart: "09:30",
  visitRadiusM: 200,
  offBeat: true,
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function fieldSettings(settings: unknown): FieldSettings {
  const d = ((settings ?? {}) as { field?: Partial<FieldSettings> }).field ?? {};
  const m = { ...FIELD_DEFAULTS, ...d };
  if (typeof m.workStart !== "string" || !HHMM.test(m.workStart)) m.workStart = FIELD_DEFAULTS.workStart;
  return m;
}

export function parseFieldSettings(input: Record<string, unknown>): Partial<FieldSettings> | string {
  const out: Partial<FieldSettings> = {};
  for (const k of ["selfie", "geo", "trackLocation", "offBeat"] as const) if (k in input) out[k] = input[k] === true;
  const int = (k: "pingMinutes" | "pingRetentionDays" | "visitRadiusM", min: number, max: number, label: string) => {
    if (!(k in input)) return null;
    const v = input[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return `${label} must be ${min} to ${max}`;
    out[k] = v;
    return null;
  };
  const e =
    int("pingMinutes", 1, 60, "Minutes between positions") ??
    int("pingRetentionDays", 7, 365, "Keep positions for (days)") ??
    int("visitRadiusM", 25, 5000, "Visit distance (metres)");
  if (e) return e;
  if ("workStart" in input) {
    if (typeof input.workStart !== "string" || !HHMM.test(input.workStart)) return "Work start must be a time like 09:30";
    out.workStart = input.workStart;
  }
  return out;
}

/** Why a visit ended without an order. Keys are stored; labels are shown. */
export const NO_ORDER_REASONS = {
  stock_enough: "Has enough stock",
  owner_away: "Owner not there",
  shop_closed: "Shop closed",
  dues_pending: "Old dues pending",
  price: "Price or scheme issue",
  other_supplier: "Buys from another supplier",
  next_visit: "Will order next visit",
  other: "Other",
} as const;
export type NoOrderReason = keyof typeof NO_ORDER_REASONS;
export const isNoOrderReason = (v: unknown): v is NoOrderReason => typeof v === "string" && v in NO_ORDER_REASONS;

export const LEAVE_TYPES = {
  casual: "Casual leave",
  sick: "Sick leave",
  earned: "Earned leave",
  unpaid: "Unpaid leave",
} as const;
export type LeaveType = keyof typeof LEAVE_TYPES;
export const isLeaveType = (v: unknown): v is LeaveType => typeof v === "string" && v in LEAVE_TYPES;

export const METRIC_LABEL = {
  VALUE: "Order value",
  VOLUME: "Units ordered",
  NEW_OUTLETS: "New shops",
  COLLECTION: "Collection",
} as const;

/** Money metrics are in paise. */
export const MONEY_METRICS = new Set(["VALUE", "COLLECTION"]);

export const EXCEPTION_LABEL = {
  absent: "Not checked in",
  late: "Late check-in",
  no_checkout: "Did not check out",
  far_visit: "Visit far from the shop",
  ping_gap: "No position for a long time",
  low_coverage: "Beat not covered",
  no_visits: "No visits",
} as const;
export type ExceptionKind = keyof typeof EXCEPTION_LABEL;

/** Field roles: they check in, may be tracked on duty, and can have supervisors. */
export const FIELD_ROLES = ["SALES_AGENT", "DELIVERY_AGENT", "SUPERVISOR"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];
export const isFieldRole = (r: unknown): r is FieldRole => typeof r === "string" && (FIELD_ROLES as readonly string[]).includes(r);
