/**
 * Delivery rules, stored in Tenant.settings.delivery (Admin → Settings →
 * Delivery). Defaults: morning and evening slots, no delivery code, photo
 * optional, no depot (route order then starts from the first stop).
 */
export type Slot = { key: string; label: string; labelHi?: string };

export type DeliverySettings = {
  slots: Slot[];
  /** Order total (paise) from which the retailer's delivery code is needed. 0 = never. */
  codeAbove: number;
  /** A delivery photo is required to mark an order delivered. */
  photoRequired: boolean;
  /** Where trips start (warehouse); used by automatic route order. */
  depot: { lat: number; lng: number } | null;
};

export const DELIVERY_DEFAULTS: DeliverySettings = {
  slots: [
    { key: "morning", label: "Morning", labelHi: "सुबह" },
    { key: "evening", label: "Evening", labelHi: "शाम" },
  ],
  codeAbove: 0,
  photoRequired: false,
  depot: null,
};

export function deliverySettings(settings: unknown): DeliverySettings {
  const d = ((settings ?? {}) as { delivery?: Partial<DeliverySettings> }).delivery ?? {};
  const merged = { ...DELIVERY_DEFAULTS, ...d };
  if (!Array.isArray(merged.slots) || merged.slots.length === 0) merged.slots = DELIVERY_DEFAULTS.slots;
  return merged;
}

export const slotLabel = (s: DeliverySettings, key: string) => s.slots.find((x) => x.key === key)?.label ?? key;

const isLat = (v: unknown) => typeof v === "number" && v >= -90 && v <= 90;
const isLng = (v: unknown) => typeof v === "number" && v >= -180 && v <= 180;

export function parseDeliverySettings(input: Record<string, unknown>): Partial<DeliverySettings> | string {
  const out: Partial<DeliverySettings> = {};
  if ("slots" in input) {
    if (!Array.isArray(input.slots) || input.slots.length === 0 || input.slots.length > 6) return "Add 1 to 6 delivery slots";
    const slots: Slot[] = [];
    for (const raw of input.slots as Record<string, unknown>[]) {
      const label = String(raw?.label ?? "").trim().slice(0, 30);
      if (!label) return "Every slot needs a name";
      const key = String(raw?.key ?? label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20);
      if (!key) return "Every slot needs a name in English letters";
      if (slots.some((s) => s.key === key)) return `Two slots are called "${label}"`;
      const labelHi = String(raw?.labelHi ?? "").trim().slice(0, 30);
      slots.push(labelHi ? { key, label, labelHi } : { key, label });
    }
    out.slots = slots;
  }
  if ("codeAbove" in input) {
    const v = input.codeAbove;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100_000_000_00) return "Delivery code amount must be 0 or more";
    out.codeAbove = v;
  }
  if ("photoRequired" in input) out.photoRequired = input.photoRequired === true;
  if ("depot" in input) {
    const d = input.depot as { lat?: unknown; lng?: unknown } | null;
    if (d === null) out.depot = null;
    else if (!d || !isLat(d.lat) || !isLng(d.lng)) return "Warehouse location needs a valid latitude and longitude";
    else out.depot = { lat: d.lat as number, lng: d.lng as number };
  }
  return out;
}

/** Why an order couldn't be delivered at all. Keys are stored; labels are shown. */
export const FAIL_REASONS = {
  shop_closed: "Shop closed",
  owner_away: "Owner not available",
  refused: "Retailer refused the order",
  no_payment: "Payment not ready",
  wrong_address: "Couldn't find the shop",
  no_time: "Ran out of time",
  vehicle: "Vehicle problem",
  other: "Other",
} as const;

/** Why less than ordered was handed over on a line. */
export const SHORT_REASONS = {
  damaged: "Damaged",
  expired: "Expired or near expiry",
  refused: "Retailer didn't want it",
  short_loaded: "Not loaded / short in van",
  wrong_item: "Wrong item",
  other: "Other",
} as const;

export type FailReason = keyof typeof FAIL_REASONS;
export type ShortReason = keyof typeof SHORT_REASONS;
export const isFailReason = (v: unknown): v is FailReason => typeof v === "string" && v in FAIL_REASONS;
export const isShortReason = (v: unknown): v is ShortReason => typeof v === "string" && v in SHORT_REASONS;

export const PREF_LABEL = {
  RING_BELL: "Ring the bell",
  AT_DOOR: "Leave at the door",
  IN_HAND: "Hand it to the owner",
  KEEP_IN_BAG: "Keep in a bag",
} as const;

/** Body { deliveryPref?, deliveryNote?, lat?, lng? } → RetailerProfile fields (lat / lng only when allowed). */
export function parseRetailerDelivery(b: Record<string, unknown>, opts: { location: boolean }) {
  const out: { deliveryPref?: keyof typeof PREF_LABEL | null; deliveryNote?: string | null; lat?: number | null; lng?: number | null } = {};
  if ("deliveryPref" in b) {
    if (b.deliveryPref !== null && b.deliveryPref !== "" && !(typeof b.deliveryPref === "string" && b.deliveryPref in PREF_LABEL)) return "Pick how goods should be handed over";
    out.deliveryPref = (b.deliveryPref || null) as keyof typeof PREF_LABEL | null;
  }
  if ("deliveryNote" in b) out.deliveryNote = String(b.deliveryNote ?? "").trim().slice(0, 140) || null;
  if (opts.location && ("lat" in b || "lng" in b)) {
    if (b.lat === null && b.lng === null) {
      out.lat = null;
      out.lng = null;
    } else if (isLat(b.lat) && isLng(b.lng)) {
      out.lat = b.lat as number;
      out.lng = b.lng as number;
    } else return "Location needs a valid latitude and longitude";
  }
  return out;
}
