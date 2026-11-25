/** Free-goods deals like 10+1. Pure: safe in the browser and on the server. */
export type Deal = { buy: number; get: number };

/** "10+1" → { buy: 10, get: 1 }; "" → null; anything else → "bad". */
export function parseDeal(text: string): Deal | null | "bad" {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d+)\s*\+\s*(\d+)$/.exec(t);
  if (!m) return "bad";
  const buy = Number(m[1]);
  const get = Number(m[2]);
  return buy >= 1 && get >= 1 && buy <= 100_000 && get <= 100_000 ? { buy, get } : "bad";
}

/** Free units a deal gives on a line, whole sets only; a line ordered in cases counts cases. */
export function dealFree(line: { quantity: number; cases?: number | null; caseSize?: number | null }, deal: Deal) {
  if (line.cases && line.caseSize) return Math.floor(line.cases / deal.buy) * deal.get * line.caseSize;
  return Math.floor(line.quantity / deal.buy) * deal.get;
}
