/**
 * Pure stock maths (no database), shared by lib/stock.ts, screens and tests.
 */

export type LotLike = { id: string; qty: number; expiry: Date | null; receivedAt: Date; batch?: string };

/** IST calendar day "YYYY-MM-DD" as a UTC-midnight Date (how @db.Date values come back). */
export function istToday(d = new Date()): Date {
  const ymd = new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Expired = expiry date before today (goods are sellable on their expiry day). */
export const isExpired = (lot: { expiry: Date | null }, today: Date) => lot.expiry !== null && lot.expiry.getTime() < today.getTime();

/** First expiry first out: earliest expiry, lots without expiry last, then oldest received. */
export function fefoSort<T extends LotLike>(lots: T[]): T[] {
  return [...lots].sort((a, b) => {
    const ea = a.expiry?.getTime() ?? Number.POSITIVE_INFINITY;
    const eb = b.expiry?.getTime() ?? Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea - eb;
    return a.receivedAt.getTime() - b.receivedAt.getTime();
  });
}

/**
 * Which lots to take qty from, first expiry first. Expired lots are skipped
 * unless allowed. short = what the lots couldn't cover.
 */
export function pickFefo<T extends LotLike>(lots: T[], qty: number, opts: { today: Date; allowExpired?: boolean }) {
  const picks: { lot: T; qty: number }[] = [];
  let left = qty;
  for (const lot of fefoSort(lots)) {
    if (left <= 0) break;
    if (lot.qty <= 0) continue;
    if (!opts.allowExpired && isExpired(lot, opts.today)) continue;
    const take = Math.min(lot.qty, left);
    picks.push({ lot, qty: take });
    left -= take;
  }
  return { picks, short: left };
}

/** Round a quantity up to whole cases when the product has a case size. */
export const roundUpToCase = (qty: number, caseSize: number | null | undefined) =>
  caseSize && caseSize > 1 ? Math.ceil(qty / caseSize) * caseSize : qty;

/** Suggested purchase quantity for a product at or below its reorder level. */
export function reorderSuggestion(p: { available: number; reorderLevel: number | null; reorderQty: number | null; caseSize?: number | null }) {
  if (p.reorderLevel === null || p.available > p.reorderLevel) return 0;
  const want = p.reorderQty ?? Math.max(1, p.reorderLevel * 2 - p.available);
  return roundUpToCase(want, p.caseSize);
}

/**
 * Van load for a trip: target = what the trip's open stops need + what other
 * open trips on this van still need + buffer; load = target − already in the van.
 */
export function loadLine(p: { need: number; otherNeed: number; inVan: number; bufferPct: number; caseSize?: number | null }) {
  const buffer = p.need > 0 ? roundUpToCase(Math.ceil((p.need * p.bufferPct) / 100), p.caseSize) : 0;
  const forOrders = Math.max(0, p.need + p.otherNeed - p.inVan);
  const withBuffer = Math.max(0, p.need + p.otherNeed + buffer - p.inVan);
  return { buffer, forOrders, suggested: withBuffer };
}
