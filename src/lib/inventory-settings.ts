/**
 * Stock rules, stored in Tenant.settings.inventory (Admin → Settings →
 * Stock). Stock tracking is off until the business turns it on; while it is
 * off nothing moves stock and every screen works as before.
 */
export type OrderCheck = "off" | "warn" | "block";

export type InventorySettings = {
  enabled: boolean;
  /** What happens when an order asks for more than is available: nothing, a warning, or the order is refused. */
  orderCheck: OrderCheck;
  /** Extra stock (% of the trip's orders) suggested on the van for spot sales. */
  bufferPct: number;
  /** Batches expiring within this many days are flagged. */
  expiryAlertDays: number;
};

export const INVENTORY_DEFAULTS: InventorySettings = {
  enabled: false,
  orderCheck: "warn",
  bufferPct: 10,
  expiryAlertDays: 7,
};

export function inventorySettings(settings: unknown): InventorySettings {
  const d = ((settings ?? {}) as { inventory?: Partial<InventorySettings> }).inventory ?? {};
  const merged = { ...INVENTORY_DEFAULTS, ...d };
  if (!["off", "warn", "block"].includes(merged.orderCheck)) merged.orderCheck = INVENTORY_DEFAULTS.orderCheck;
  return merged;
}

export function parseInventorySettings(input: Record<string, unknown>): Partial<InventorySettings> | string {
  const out: Partial<InventorySettings> = {};
  if ("enabled" in input) out.enabled = input.enabled === true;
  if ("orderCheck" in input) {
    if (input.orderCheck !== "off" && input.orderCheck !== "warn" && input.orderCheck !== "block") return "Pick what happens when stock is short";
    out.orderCheck = input.orderCheck;
  }
  if ("bufferPct" in input) {
    const v = input.bufferPct;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 200) return "Van buffer must be 0 to 200%";
    out.bufferPct = v;
  }
  if ("expiryAlertDays" in input) {
    const v = input.expiryAlertDays;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 365) return "Expiry warning must be 0 to 365 days";
    out.expiryAlertDays = v;
  }
  return out;
}

/** Why stock was adjusted by hand. Keys are stored; labels are shown. */
export const ADJUST_REASONS = {
  count: "Stock count correction",
  found: "Found extra",
  lost: "Lost or stolen",
  sample: "Free sample / promotion",
  own_use: "Own use",
  opening: "Opening stock",
  other: "Other",
} as const;

/** Set by the system: a sale or load needed more than the records showed. */
export const AUTO_REASONS = {
  sold_unrecorded: "Records were short at sale",
  loaded_unrecorded: "Records were short at loading",
  van_shortage: "Missing from van at unload",
  van_found: "Extra in van at unload",
} as const;

/** Why goods went to the damaged bin. */
export const DAMAGE_REASONS = {
  damaged: "Damaged",
  expired: "Expired",
  leaking: "Leaking / broken seal",
  other: "Other",
} as const;

/** Condition of goods a retailer sent back. */
export const RETURN_CONDITIONS = {
  good: "Good: back into stock",
  damaged: "Damaged",
  expired: "Expired",
} as const;

export type AdjustReason = keyof typeof ADJUST_REASONS;
export type DamageReason = keyof typeof DAMAGE_REASONS;
export type ReturnCondition = keyof typeof RETURN_CONDITIONS;
export const isAdjustReason = (v: unknown): v is AdjustReason => typeof v === "string" && v in ADJUST_REASONS;
export const isDamageReason = (v: unknown): v is DamageReason => typeof v === "string" && v in DAMAGE_REASONS;
export const isReturnCondition = (v: unknown): v is ReturnCondition => typeof v === "string" && v in RETURN_CONDITIONS;

export const reasonLabel = (r: string | null | undefined) =>
  !r ? "" : ((ADJUST_REASONS as Record<string, string>)[r] ?? (AUTO_REASONS as Record<string, string>)[r] ?? (DAMAGE_REASONS as Record<string, string>)[r] ?? (RETURN_CONDITIONS as Record<string, string>)[r] ?? r);

export const MOVE_LABEL = {
  OPENING: "Opening stock",
  PURCHASE: "Received",
  TRANSFER: "Transfer",
  LOAD: "Loaded on van",
  UNLOAD: "Unloaded from van",
  SALE: "Sold",
  RETURN: "Returned by retailer",
  DAMAGE: "To damaged",
  WRITE_OFF: "Written off",
  SUPPLIER_RETURN: "Sent back to supplier",
  ADJUST: "Adjusted",
} as const;
