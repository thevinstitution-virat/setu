/**
 * Van stock as GET /api/delivery/van sends it (dates as "YYYY-MM-DD"), and
 * small display helpers shared by the van stock and spot sale screens.
 * Client-safe: no server modules.
 */

export type VanLot = { batch: string; expiry: string | null; qty: number };

export type VanRow = {
  productId: string;
  name: string;
  unit: string;
  caseSize: number | null;
  onHand: number;
  /** Units in lots past their expiry date (never sold). */
  expired: number;
  /** Held for the trip's open stops. */
  reserved: number;
  /** May be spot-sold. */
  free: number;
  lots: VanLot[];
};

export type VanTrip = {
  id: string;
  number: string;
  status: "PLANNED" | "STARTED" | "CLOSED";
  vehicle: { id: string; number: string } | null;
};

export type VanData = {
  /** false = the business doesn't track stock: no van screens at all. */
  enabled: boolean;
  trip: VanTrip | null;
  /** True while the trip is running. */
  canSell?: boolean;
  rows: VanRow[];
};

export async function fetchVan(): Promise<VanData> {
  const res = await fetch("/api/delivery/van");
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? "Could not load the van stock");
  return d as VanData;
}

/** Today in India as "YYYY-MM-DD" (lots are good on their expiry day). */
export const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export const lotExpired = (lot: VanLot, today: string) => lot.expiry !== null && lot.expiry < today;

/** "2026-11-20" → "20 Nov 2026" (a calendar date, never shifted by time zone). */
export const expiryLabel = (ymd: string) =>
  new Date(`${ymd}T00:00:00.000Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "50 pcs" or, for products sold in cases, "50 pcs (2 cases + 2)". */
export function unitsLabel(qty: number, unit: string, caseSize: number | null) {
  const base = `${qty} ${unit}`;
  if (!caseSize || caseSize < 2 || qty < caseSize) return base;
  const cases = Math.floor(qty / caseSize);
  const rest = qty % caseSize;
  return `${base} (${cases} case${cases === 1 ? "" : "s"}${rest ? ` + ${rest}` : ""})`;
}
