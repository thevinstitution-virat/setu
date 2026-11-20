/**
 * Pure field-sales maths (client-safe, unit tested): IST days, distance from
 * location pings, late check-in, leave days, target achievement and payout.
 */

const IST_MS = 330 * 60_000;

/** IST calendar day of an instant, YYYY-MM-DD. */
export const istDay = (d: Date = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);

/** IST month, YYYY-MM. */
export const istMonth = (d: Date = new Date()) => istDay(d).slice(0, 7);

/** Start (inclusive) and end (exclusive) instants of an IST day. */
export function istDayRange(day: string): { from: Date; to: Date } {
  const from = new Date(new Date(`${day}T00:00:00.000Z`).getTime() - IST_MS);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

/** Start (inclusive) and end (exclusive) instants of an IST month (YYYY-MM). */
export function istMonthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1) - IST_MS);
  const to = new Date(Date.UTC(y, m, 1) - IST_MS);
  return { from, to };
}

export const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
export const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** 0 = Sunday … 6 = Saturday, for an IST day. */
export const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

export const addDay = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Days from a to b inclusive (0 when b < a). */
export const daysInclusive = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1);

/** Every IST day from a to b inclusive. */
export function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDay(d, 1)) out.push(d);
  return out;
}

/** Minutes past midnight IST of an instant. */
export const istMinutes = (d: Date) => {
  const t = new Date(d.getTime() + IST_MS);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};

/** Checked in after the work start time (HH:MM, IST)? */
export function isLate(checkInAt: Date, workStart: string): boolean {
  const [h, m] = workStart.split(":").map(Number);
  return istMinutes(checkInAt) > h * 60 + m;
}

const RAD = Math.PI / 180;
/** Metres between two points (haversine). */
export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}

export type Ping = { at: Date; lat: number; lng: number; accuracy: number | null };

/**
 * Distance travelled along pings, in metres. Drops fixes worse than 100 m,
 * ignores moves smaller than the fixes' accuracy (GPS jitter while standing)
 * and jumps faster than 150 km/h (bad fixes).
 */
export function pathMetres(pings: Ping[], { maxAccuracy = 100, maxKmh = 150 } = {}): number {
  const good = pings.filter((p) => p.accuracy == null || p.accuracy <= maxAccuracy).sort((a, b) => a.at.getTime() - b.at.getTime());
  let total = 0;
  let last: Ping | null = null;
  for (const p of good) {
    if (!last) {
      last = p;
      continue;
    }
    const d = metres(last, p);
    const noise = Math.max(20, (last.accuracy ?? 20) + (p.accuracy ?? 20)) / 2;
    if (d < noise) continue; // standing still: keep the earlier anchor
    const hours = (p.at.getTime() - last.at.getTime()) / 3_600_000;
    if (hours > 0 && d / 1000 / hours > maxKmh) continue; // impossible jump: skip this fix
    total += d;
    last = p;
  }
  return Math.round(total);
}

/** Longest gap between consecutive pings (minutes) within [from, to]; whole span when there are none. */
export function longestGapMinutes(pings: { at: Date }[], from: Date, to: Date): number {
  const times = [from.getTime(), ...pings.map((p) => p.at.getTime()).filter((t) => t >= from.getTime() && t <= to.getTime()).sort((a, b) => a - b), to.getTime()];
  let gap = 0;
  for (let i = 1; i < times.length; i++) gap = Math.max(gap, times[i] - times[i - 1]);
  return Math.round(gap / 60_000);
}

/** Achievement % (whole number, floor) of a goal. */
export const pctOf = (achieved: number, goal: number) => (goal > 0 ? Math.floor((achieved * 100) / goal) : 0);

/**
 * Incentive earned: nothing below minPct; from minPct to capPct it is the
 * incentive × achieved % (so 100 % pays the incentive); above capPct it stays
 * at the cap. Paise, rounded down.
 */
export function payout(t: { goal: number; incentive: number; minPct: number; capPct: number }, achieved: number): number {
  if (t.goal <= 0 || t.incentive <= 0) return 0;
  const ratio = achieved / t.goal;
  if (ratio * 100 < t.minPct) return 0;
  return Math.floor(t.incentive * Math.min(ratio, t.capPct / 100));
}

/** FSSAI licence / registration numbers are 14 digits. */
export const validFssai = (v: string) => /^\d{14}$/.test(v);

/** Indian mobile number: 10 digits starting 6–9. */
export const validMobile = (v: string) => /^[6-9]\d{9}$/.test(v);
